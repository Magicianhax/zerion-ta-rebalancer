"""Tiny energy-based voice activity detector.

We don't pull webrtcvad (would require a C compile on the Pi). Instead we
compute a moving RMS over short audio frames and detect speech vs. silence
with a hysteresis threshold. Good enough for capturing one user utterance at
a time before sending it to STT.

Use:
    vad = SimpleVAD(sample_rate=16000)
    vad.feed(pcm16_chunk)
    if vad.utterance_ended:
        full_audio = vad.consume_utterance()
"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass

import numpy as np

log = logging.getLogger("bablu.vad")


import os


@dataclass
class SimpleVAD:
    sample_rate: int = 16000
    # Threshold tuned to overcome typical USB-mic noise floors (~800 RMS) while
    # still triggering on normal speech (~1500–8000). Override via VAD_THRESHOLD
    # env if a mic is louder/quieter than the default.
    rms_threshold: float = float(os.environ.get("VAD_THRESHOLD", "1500"))
    activation_frames: int = 3       # frames above threshold to start an utterance
    # ms of silence to consider speech ended — long enough to allow a natural
    # pause mid-thought without cutting the user off. Override via env.
    silence_ms_to_end: int = int(os.environ.get("VAD_SILENCE_MS", "2000"))
    # Catch quick "yes"/"no"/"go" confirmations — was 300, too strict for monosyllables.
    min_utterance_ms: int = int(os.environ.get("VAD_MIN_MS", "150"))

    def __post_init__(self) -> None:
        self._in_speech = False
        self._buffer: deque[bytes] = deque()
        self._above = 0
        self._silence_ms = 0
        self._speech_ms = 0
        self._utterance_complete: bytes | None = None

    def feed(self, pcm16: bytes) -> None:
        """Process one chunk of mic audio."""
        if self._utterance_complete is not None:
            # caller hasn't consumed previous utterance yet
            return

        samples = np.frombuffer(pcm16, dtype=np.int16)
        if samples.size == 0:
            return
        rms = float(np.sqrt(np.mean(samples.astype(np.float32) ** 2)))
        chunk_ms = int(1000 * samples.size / self.sample_rate)

        if rms >= self.rms_threshold:
            self._above += 1
            if not self._in_speech and self._above >= self.activation_frames:
                self._in_speech = True
                self._speech_ms = 0
                log.debug("vad: speech started (rms=%.0f)", rms)
            if self._in_speech:
                self._buffer.append(pcm16)
                self._speech_ms += chunk_ms
                self._silence_ms = 0
        else:
            self._above = max(0, self._above - 1)
            if self._in_speech:
                self._buffer.append(pcm16)
                self._silence_ms += chunk_ms
                if self._silence_ms >= self.silence_ms_to_end:
                    if self._speech_ms >= self.min_utterance_ms:
                        self._utterance_complete = b"".join(self._buffer)
                        log.debug(
                            "vad: speech ended (%d ms speech, %d ms silence)",
                            self._speech_ms, self._silence_ms,
                        )
                    else:
                        log.debug("vad: rejected short utterance (%d ms)", self._speech_ms)
                    self._reset()

    def _reset(self) -> None:
        self._in_speech = False
        self._buffer.clear()
        self._above = 0
        self._silence_ms = 0
        self._speech_ms = 0

    @property
    def utterance_ready(self) -> bool:
        return self._utterance_complete is not None

    def consume_utterance(self) -> bytes:
        """Return the completed utterance bytes and clear the buffer."""
        assert self._utterance_complete is not None
        out = self._utterance_complete
        self._utterance_complete = None
        return out

    @property
    def in_speech(self) -> bool:
        return self._in_speech
