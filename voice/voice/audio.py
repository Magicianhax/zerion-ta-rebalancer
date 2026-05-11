"""Audio I/O for the Realtime agent.

The OpenAI Realtime API expects PCM16 mono at 24 kHz on input and produces the
same on output. We use `sounddevice` for cross-platform capture/playback.

Two queues bridge the audio threads (which sounddevice runs in C) and the
asyncio event loop:

  mic  ── PortAudio thread ──► mic_q   ── asyncio consumer ──► WebSocket out
  speaker ◄── PortAudio thread ◄── speaker_q ◄── WebSocket consumer

Run on the Pi after `apt install portaudio19-dev` and `pip install -e .[pi]`.
"""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
from typing import AsyncIterator

import numpy as np

log = logging.getLogger("bablu.audio")

SAMPLE_RATE = 24_000
CHANNELS = 1
DTYPE = "int16"
FRAME_MS = 40                         # 40ms chunks → 960 samples
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000


class AudioIO:
    """Mic capture + speaker playback using sounddevice streams."""

    def __init__(self, *, speaker_only: bool = False) -> None:
        try:
            import sounddevice as sd  # noqa: F401  (imported for side-effect of error)
        except OSError as exc:
            raise RuntimeError(
                "sounddevice import failed — install portaudio19-dev on the Pi: "
                "sudo apt install -y portaudio19-dev"
            ) from exc
        self._sd = __import__("sounddevice")
        self._speaker_only = speaker_only
        self._mic_q: queue.Queue[bytes] = queue.Queue(maxsize=128)
        # Generous speaker buffer — TTS chunks arrive in bursts, callback drains
        # smoothly. Too small = audible underruns; too big = laggy first-audio.
        self._speaker_q: queue.Queue[bytes] = queue.Queue(maxsize=4096)
        self._mic_stream = None
        self._speaker_stream = None
        self._stopped = threading.Event()

    # ---------- lifecycle ----------

    def start(self) -> None:
        sd = self._sd

        def mic_cb(indata: np.ndarray, frames: int, _time, status) -> None:
            if status:
                log.debug("mic status %s", status)
            try:
                self._mic_q.put_nowait(indata.tobytes())
            except queue.Full:
                log.warning("mic queue full — dropping frame")

        # Inter-callback PCM accumulator — TTS chunks aren't aligned to the
        # speaker callback's frame count. We pull chunks until we've satisfied
        # the requested frames; leftover stays in `pending` for next callback.
        pending = bytearray()

        def speaker_cb(outdata: np.ndarray, frames: int, _time, status) -> None:
            if status:
                log.debug("speaker status %s", status)
            need_bytes = frames * 2  # int16 mono
            while len(pending) < need_bytes:
                try:
                    pending.extend(self._speaker_q.get_nowait())
                except queue.Empty:
                    break
            if pending:
                take = min(need_bytes, len(pending))
                arr = np.frombuffer(bytes(pending[:take]), dtype=np.int16)
                del pending[:take]
                n = arr.size
                outdata[:n, 0] = arr
                if n < frames:
                    outdata[n:] = 0
            else:
                outdata[:] = 0

        if not self._speaker_only:
            self._mic_stream = sd.InputStream(
                samplerate=SAMPLE_RATE, channels=CHANNELS, dtype=DTYPE,
                blocksize=FRAME_SAMPLES, callback=mic_cb,
            )
            self._mic_stream.start()
        self._speaker_stream = sd.OutputStream(
            samplerate=SAMPLE_RATE, channels=CHANNELS, dtype=DTYPE,
            blocksize=FRAME_SAMPLES, callback=speaker_cb,
        )
        self._speaker_stream.start()
        mode = "speaker-only" if self._speaker_only else "mic + speaker"
        log.info("audio: %s streams started @ %dHz", mode, SAMPLE_RATE)

    def stop(self) -> None:
        self._stopped.set()
        for s in (self._mic_stream, self._speaker_stream):
            if s is not None:
                try: s.stop(); s.close()
                except Exception: pass

    # ---------- mic ----------

    async def mic_chunks(self) -> AsyncIterator[bytes]:
        """Yields raw PCM16 mono bytes — pull from the thread-safe queue."""
        loop = asyncio.get_running_loop()
        while not self._stopped.is_set():
            chunk = await loop.run_in_executor(None, self._mic_q.get)
            yield chunk

    # ---------- speaker ----------

    def play(self, pcm16_bytes: bytes) -> None:
        """Push PCM16 mono bytes to the speaker. Non-blocking; drops on overflow."""
        try:
            self._speaker_q.put_nowait(pcm16_bytes)
        except queue.Full:
            log.warning("speaker queue full — dropping audio (~%d bytes)", len(pcm16_bytes))

    def flush(self) -> None:
        """Drain pending speaker audio (e.g. on user interrupt)."""
        with self._speaker_q.mutex:
            self._speaker_q.queue.clear()

    def speaker_queued_bytes(self) -> int:
        """Approximate bytes still waiting in the speaker queue."""
        return sum(len(b) for b in list(self._speaker_q.queue))
