"""HTTP clients for the three external services Bablu uses.

- ElevenLabs Scribe STT  : POST /v1/speech-to-text  (multipart upload of mic-buffer)
- ElevenLabs TTS streaming: POST /v1/text-to-speech/{voice_id}/stream  (PCM out)
- OpenAI Chat Completions : POST /v1/chat/completions  (tools, streaming text)

All thin wrappers — no SDKs, just `httpx`. Keeps the dep tree small enough that
`pip install` finishes on a Pi 3B in well under a minute.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, AsyncIterator, Iterable

import httpx

log = logging.getLogger("bablu.clients")

ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"
OPENAI_BASE = "https://api.openai.com/v1"


# ============================================================================
# ElevenLabs Scribe — speech-to-text
# ============================================================================

def _pad_pcm16_to_seconds(pcm: bytes, sample_rate: int, target_seconds: float) -> bytes:
    """Append silence to a PCM16 mono buffer so it's at least target_seconds long.
    Used to satisfy ElevenLabs Voice Isolator's 4.6 s minimum on short utterances.
    """
    current_seconds = len(pcm) / (sample_rate * 2)
    if current_seconds >= target_seconds:
        return pcm
    extra_samples = int((target_seconds - current_seconds) * sample_rate)
    return pcm + b"\x00\x00" * extra_samples


async def stt_transcribe(audio_pcm16_bytes: bytes, *, sample_rate: int) -> str:
    """Send raw PCM16 mono bytes to ElevenLabs Scribe and return the transcript.

    Scribe accepts WAV / MP3 / etc.; we wrap the PCM in a minimal WAV header so
    we don't need to import soundfile.
    """
    api_key = os.environ["ELEVENLABS_API_KEY"]
    wav_bytes = _wrap_pcm16_as_wav(audio_pcm16_bytes, sample_rate=sample_rate)

    # Retry once on transient connect errors; force English so Scribe doesn't
    # mis-detect background noise as Spanish/etc.
    last_exc: Exception | None = None
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as cx:
                r = await cx.post(
                    f"{ELEVENLABS_BASE}/speech-to-text",
                    headers={"xi-api-key": api_key},
                    data={"model_id": "scribe_v1", "language_code": "en"},
                    files={"file": ("audio.wav", wav_bytes, "audio/wav")},
                )
            r.raise_for_status()
            break
        except (httpx.ConnectTimeout, httpx.ConnectError) as exc:
            last_exc = exc
            log.warning("STT connect failed (attempt %d): %s", attempt + 1, exc)
            if attempt == 1:
                raise
    text = r.json().get("text", "").strip()
    log.info("STT  | %s", text or "(empty)")
    return text


async def voice_isolate(audio_pcm16_bytes: bytes, *, sample_rate: int = 16000) -> bytes:
    """Strip background noise / isolate vocals via ElevenLabs Audio Isolator.

    Input: raw PCM16 mono. We use `file_format=pcm_s16le_16` low-latency mode
    when sample_rate==16000 (skips decode). Output: MP3 bytes — Scribe accepts
    MP3 directly so we can pipe it straight into stt_transcribe_mp3.

    Costs character credits per second of audio — disable via
    BABLU_USE_ISOLATOR=0 to save budget.
    """
    api_key = os.environ["ELEVENLABS_API_KEY"]
    headers = {"xi-api-key": api_key}
    # Isolator requires audio >= 4.6 s. Pad short clips with trailing silence so
    # quick commands like "Bablu say hi" still get the noise-strip benefit.
    padded = _pad_pcm16_to_seconds(audio_pcm16_bytes, sample_rate, 5.0)
    if sample_rate == 16000:
        files = {"audio": ("audio.pcm", padded, "application/octet-stream")}
        data = {"file_format": "pcm_s16le_16"}
    else:
        files = {"audio": ("audio.wav", _wrap_pcm16_as_wav(padded, sample_rate=sample_rate), "audio/wav")}
        data = {"file_format": "other"}
    async with httpx.AsyncClient(timeout=30) as cx:
        r = await cx.post(
            f"{ELEVENLABS_BASE}/audio-isolation",
            headers=headers,
            files=files,
            data=data,
        )
    if r.status_code >= 400:
        log.warning("ISOL %s: %s", r.status_code, r.text[:300])
    r.raise_for_status()
    out = r.content  # MP3 by default
    log.info("ISOL | in=%d bytes pcm → out=%d bytes mp3", len(audio_pcm16_bytes), len(out))
    return out


async def stt_transcribe_mp3(mp3_bytes: bytes) -> str:
    """STT for MP3 bytes (e.g. output of voice_isolate)."""
    api_key = os.environ["ELEVENLABS_API_KEY"]
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as cx:
                r = await cx.post(
                    f"{ELEVENLABS_BASE}/speech-to-text",
                    headers={"xi-api-key": api_key},
                    data={"model_id": "scribe_v1", "language_code": "en"},
                    files={"file": ("clean.mp3", mp3_bytes, "audio/mpeg")},
                )
            r.raise_for_status()
            break
        except (httpx.ConnectTimeout, httpx.ConnectError) as exc:
            log.warning("STT(mp3) connect failed (attempt %d): %s", attempt + 1, exc)
            if attempt == 1:
                raise
    text = r.json().get("text", "").strip()
    log.info("STT  | %s", text or "(empty)")
    return text


def _wrap_pcm16_as_wav(pcm: bytes, *, sample_rate: int, channels: int = 1) -> bytes:
    """Minimal RIFF/WAVE wrapper around raw PCM16 LE samples."""
    import struct
    byte_rate = sample_rate * channels * 2
    block_align = channels * 2
    data_len = len(pcm)
    riff_len = 36 + data_len
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", riff_len, b"WAVE",
        b"fmt ", 16, 1, channels, sample_rate, byte_rate, block_align, 16,
        b"data", data_len,
    )
    return header + pcm


# ============================================================================
# ElevenLabs TTS — streaming
# ============================================================================

async def tts_stream(
    text: str,
    *,
    voice_id: str,
    sample_rate: int = 24000,
    model_id: str | None = None,
    speed: float | None = None,
) -> AsyncIterator[bytes]:
    """Stream PCM16 audio chunks from ElevenLabs TTS.

    Defaults: `eleven_turbo_v2_5` (good latency, much more natural pacing than
    flash_v2_5) at 0.9× speed (less rapid-fire). Override with env or args.
    Set ELEVENLABS_TTS_MODEL=eleven_multilingual_v2 for highest quality (slower).
    """
    api_key = os.environ["ELEVENLABS_API_KEY"]
    model_id = model_id or os.environ.get("ELEVENLABS_TTS_MODEL", "eleven_turbo_v2_5")
    speed = speed if speed is not None else float(os.environ.get("ELEVENLABS_TTS_SPEED", "0.9"))
    url = f"{ELEVENLABS_BASE}/text-to-speech/{voice_id}/stream"
    params = {"output_format": f"pcm_{sample_rate}"}

    body = {
        "text": text,
        "model_id": model_id,
        "voice_settings": {
            "stability": 0.55,         # higher = steadier, less jitter
            "similarity_boost": 0.8,
            "style": 0.15,
            "use_speaker_boost": True,
            "speed": speed,
        },
    }
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/pcm",
    }

    log.info("TTS  | %s", text[:120] + ("…" if len(text) > 120 else ""))
    async with httpx.AsyncClient(timeout=None) as cx:
        async with cx.stream("POST", url, headers=headers, params=params, json=body) as r:
            r.raise_for_status()
            async for chunk in r.aiter_bytes(chunk_size=4096):
                if chunk:
                    yield chunk


# ============================================================================
# OpenAI Chat Completions — text LLM brain with tools
# ============================================================================

async def chat_complete(
    messages: list[dict[str, Any]],
    *,
    tools: Iterable[dict[str, Any]] | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """One-shot non-streaming chat completion. Returns the response choice's
    message dict (which may contain `tool_calls`).
    """
    api_key = os.environ["OPENAI_API_KEY"]
    model = model or os.environ.get("OPENAI_CHAT_MODEL", "gpt-5.2")

    body: dict[str, Any] = {"model": model, "messages": messages}
    if tools:
        # ElevenLabs tool schemas use {type:"function", name, description, parameters}.
        # Chat Completions wants {type:"function", function: {name, description, parameters}}.
        body["tools"] = [_to_chat_tool(t) for t in tools]
        body["tool_choice"] = "auto"

    async with httpx.AsyncClient(timeout=60) as cx:
        r = await cx.post(
            f"{OPENAI_BASE}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=body,
        )
    if r.status_code >= 400:
        log.error("openai chat error %s: %s", r.status_code, r.text[:400])
    r.raise_for_status()
    msg: dict[str, Any] = r.json()["choices"][0]["message"]
    return msg


def _to_chat_tool(realtime_tool: dict[str, Any]) -> dict[str, Any]:
    """Convert our TOOL_SCHEMAS (Realtime-style) into Chat-Completions style."""
    return {
        "type": "function",
        "function": {
            "name": realtime_tool["name"],
            "description": realtime_tool.get("description", ""),
            "parameters": realtime_tool.get("parameters", {"type": "object", "properties": {}}),
        },
    }
