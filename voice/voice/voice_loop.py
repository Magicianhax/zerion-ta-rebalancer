"""Voice loop — Pi is a thin pipe to the rebalancer's Claude agent.

Architecture:

    mic ──► VAD ──► ElevenLabs Scribe STT ──► transcript
                                                 │
                                                 ▼ HTTP POST
                                  Rebalancer /api/voice/chat
                                                 │
                                                 ▼ (Claude Code subscription
                                                    runs the agent loop with
                                                    basket tools server-side)
                                                 │
                                                 ▼ assistant reply
                                       ElevenLabs TTS streaming
                                                 │
                                                 ▼
                                              speaker

Face state still flows the other direction:

    Rebalancer SSE ──► Pi face WebSocket ──► LCD

The Pi no longer needs OPENAI_API_KEY. All LLM cost is covered by the
Claude Code subscription already authenticated on the Linux box.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time as _time
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

from .audio import AudioIO
from .face_ws import FaceBus
from .rebalancer_client import stream_events
from .vad import SimpleVAD
from .voice_clients import (
    stt_transcribe,
    stt_transcribe_mp3,
    tts_stream,
    voice_isolate,
)

log = logging.getLogger("voice.loop")

MIC_SR = 16_000
TTS_SR = 24_000

# Stable chat_id so the rebalancer keeps conversation history across turns.
# Per-device override via env if multiple Pis share one rebalancer.
VOICE_CHAT_ID = os.environ.get("VOICE_CHAT_ID", "voice-bablu")


def _rebalancer_url() -> str:
    url = os.environ.get("REBALANCER_URL", "").rstrip("/")
    if not url:
        raise SystemExit("REBALANCER_URL not set")
    return url


def _rebalancer_token() -> str:
    tok = os.environ.get("REBALANCER_TOKEN", "")
    if not tok:
        raise SystemExit("REBALANCER_TOKEN not set")
    return tok


async def chat_with_rebalancer(text: str) -> str:
    """One round-trip to the rebalancer's voice-chat endpoint."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=120.0)) as client:
        resp = await client.post(
            f"{_rebalancer_url()}/api/agent/voice/chat",
            json={"chat_id": VOICE_CHAT_ID, "text": text},
            headers={"Authorization": f"Bearer {_rebalancer_token()}"},
        )
        resp.raise_for_status()
        return resp.json().get("text", "")


class VoiceLoop:
    def __init__(self, face: FaceBus) -> None:
        self.face = face
        self.audio = AudioIO(speaker_only=True)
        self.vad = SimpleVAD(sample_rate=MIC_SR)
        self.voice_id = os.environ.get("ELEVENLABS_VOICE_ID", "")
        if not self.voice_id:
            raise SystemExit("set ELEVENLABS_VOICE_ID in .env")
        self._face_state = "idle"
        self._mic_muted = False
        self._last_reply_at = 0.0
        self._sleeping = False

    async def _set_face(self, state: str) -> None:
        if state == self._face_state:
            return
        self._face_state = state
        await self.face.set_state(state)

    async def run(self) -> None:
        from . import audio as audio_mod
        audio_mod.SAMPLE_RATE = TTS_SR
        self.audio.start()
        await self._set_face("idle")
        try:
            await asyncio.gather(
                self._mic_loop(),
                self._utterance_processor(),
                self._sse_listener(),
                self._status_ticker(),
            )
        finally:
            self.audio.stop()

    async def _status_ticker(self) -> None:
        """Refresh the LCD's persistent info line every 30s with live basket data."""
        url = _rebalancer_url()
        headers = {"Authorization": f"Bearer {_rebalancer_token()}"}
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0)) as client:
            while True:
                try:
                    baskets_resp = await client.get(f"{url}/api/baskets", headers=headers)
                    baskets_resp.raise_for_status()
                    baskets = baskets_resp.json().get("baskets", []) or []
                    parts: list[str] = []
                    # Pull per-basket portfolio in parallel — small N, cheap.
                    pfs = await asyncio.gather(*[
                        client.get(f"{url}/api/baskets/{b['id']}/portfolio", headers=headers)
                        for b in baskets
                    ], return_exceptions=True)
                    for b, pf in zip(baskets, pfs):
                        if isinstance(pf, Exception) or pf.status_code != 200:
                            continue
                        total = pf.json().get("portfolio", {}).get("totalUsd", 0)
                        pause = "·paused" if not b.get("enabled", True) else ""
                        parts.append(f"{b['name']} ${total:.0f}{pause}")
                    text = " · ".join(parts) if parts else "no baskets yet"
                    await self.face.set_ticker(text)
                except Exception:
                    log.debug("ticker refresh failed", exc_info=True)
                await asyncio.sleep(30)

    # ── mic ────────────────────────────────────────────────────────

    async def _mic_loop(self) -> None:
        import sounddevice as sd
        loop = asyncio.get_running_loop()
        q: asyncio.Queue[bytes] = asyncio.Queue(maxsize=128)

        def cb(indata, frames, _t, status):  # type: ignore[no-untyped-def]
            if status:
                log.debug("mic status: %s", status)
            try:
                loop.call_soon_threadsafe(q.put_nowait, bytes(indata))
            except asyncio.QueueFull:
                log.warning("mic queue full")

        with sd.RawInputStream(
            samplerate=MIC_SR, channels=1, dtype="int16",
            blocksize=int(MIC_SR * 0.04),
            callback=cb,
        ):
            log.info("mic open @ %d Hz", MIC_SR)
            while True:
                chunk = await q.get()
                if self._mic_muted:
                    continue
                self.vad.feed(chunk)
                if self.vad.in_speech:
                    await self._set_face("listening" if not self._sleeping else "sleeping")
                elif self._face_state == "listening":
                    await self._set_face("idle" if not self._sleeping else "sleeping")

    async def _utterance_processor(self) -> None:
        while True:
            await asyncio.sleep(0.05)
            if not self.vad.utterance_ready:
                continue
            audio_bytes = self.vad.consume_utterance()
            await self._handle_utterance(audio_bytes)

    # ── SSE → face state ───────────────────────────────────────────

    async def _sse_listener(self) -> None:
        async def handler(event: str, payload: dict[str, Any]) -> None:
            if event == "rebalance:start":
                if self._face_state in {"idle", "sleeping"}:
                    await self.face.set_state("tx-pending", {"status": "cron tick"})
            elif event == "rebalance:done":
                if self._face_state in {"idle", "sleeping", "tx-pending"}:
                    swaps = payload.get("swaps") or []
                    if any(s.get("txHash") for s in swaps):
                        await self.face.set_state("happy", {"status": f"{len(swaps)} swap(s)"})
                        await asyncio.sleep(3)
                    await self.face.set_state("idle" if not self._sleeping else "sleeping")

        await stream_events(handler)

    # ── utterance ──────────────────────────────────────────────────

    async def _handle_utterance(self, audio_bytes: bytes) -> None:
        await self._set_face("thinking")

        # Optional noise isolation pass before STT.
        use_isolator = os.environ.get("BABLU_USE_ISOLATOR", "1") not in ("0", "false", "no")
        user_text = ""
        if use_isolator:
            try:
                clean_mp3 = await voice_isolate(audio_bytes, sample_rate=MIC_SR)
                user_text = await stt_transcribe_mp3(clean_mp3)
            except Exception as exc:  # noqa: BLE001
                log.warning("isolator failed (%s) — falling back to raw STT", exc)
        if not user_text:
            try:
                user_text = await stt_transcribe(audio_bytes, sample_rate=MIC_SR)
            except Exception:
                log.exception("STT failed")
                await self._set_face("idle")
                return
        if not user_text:
            await self._set_face("idle")
            return
        log.info("USER | %s", user_text)

        text_lower = user_text.lower()
        spoken_only = "".join(c for c in text_lower if c not in "()[]").strip()
        if (text_lower.startswith("(") and text_lower.endswith(")")) or not spoken_only:
            log.info("ignored (noise tag): %s", user_text)
            await self._set_face("idle" if not self._sleeping else "sleeping")
            return

        # sleep / wake
        wake = ("wake up", "bablu wake", "good morning")
        sleep = ("go to sleep", "good night", "sleep now", "go sleep", "be quiet")
        if self._sleeping:
            if any(p in text_lower for p in wake):
                self._sleeping = False
                await self._speak("I'm awake.")
            else:
                await self._set_face("sleeping")
            return
        if any(p in text_lower for p in sleep):
            await self._speak("Good night.")
            self._sleeping = True
            await self._set_face("sleeping")
            return

        # fuzzy wake-word gate (bypassed during a follow-up window)
        from difflib import SequenceMatcher
        threshold = float(os.environ.get("WAKE_THRESHOLD", "0.55"))
        in_follow_up = (_time.monotonic() - self._last_reply_at) < float(
            os.environ.get("FOLLOW_UP_SECONDS", "60")
        )
        if not in_follow_up and threshold > 0:
            words = [w.strip(".,!?;:'\"") for w in spoken_only.split()]
            best = max((SequenceMatcher(None, "bablu", w).ratio() for w in words if len(w) >= 3), default=0.0)
            if best < threshold:
                log.info("ignored (wake=%.2f): %s", best, user_text)
                await self._set_face("idle")
                return

        # Send transcript to the rebalancer, get assistant text back.
        try:
            reply = await chat_with_rebalancer(user_text)
        except httpx.HTTPError as exc:
            log.exception("rebalancer chat failed")
            await self._speak("Hmm, I can't reach the rebalancer. Is it running?")
            return
        if not reply:
            await self._set_face("idle")
            return
        log.info("ASSISTANT | %s", reply[:200])
        await self._speak(reply)

    # ── TTS ────────────────────────────────────────────────────────

    async def _speak(self, text: str) -> None:
        self._mic_muted = True
        started = False
        try:
            async for pcm in tts_stream(text, voice_id=self.voice_id, sample_rate=TTS_SR):
                if not started:
                    await self._set_face("speaking")
                    started = True
                self.audio.play(pcm)
            while self.audio.speaker_queued_bytes() > 0:
                await asyncio.sleep(0.05)
            await asyncio.sleep(0.25)
        except Exception:
            log.exception("TTS failed")
        finally:
            self._mic_muted = False
            self._last_reply_at = _time.monotonic()
            self.vad.__init__(sample_rate=MIC_SR)
            await self._set_face("idle")


# ── entrypoint ──────────────────────────────────────────────────────

async def _main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    # Required: rebalancer (LLM lives there) + ElevenLabs (STT/TTS).
    # OpenAI is no longer needed — Claude runs server-side via subscription.
    for var in ("ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID",
                "REBALANCER_URL", "REBALANCER_TOKEN"):
        if not os.environ.get(var):
            raise SystemExit(f"missing {var} in .env")

    face = FaceBus()
    ws_port = int(os.environ.get("FACE_WEBSOCKET_PORT", "7780"))
    face_task = asyncio.create_task(face.serve(host="0.0.0.0", port=ws_port))
    log.info("face websocket on :%d", ws_port)

    loop = VoiceLoop(face)
    try:
        await loop.run()
    finally:
        face_task.cancel()


if __name__ == "__main__":
    asyncio.run(_main())
