# Voice frontend (Raspberry Pi)

A talking, animated-face frontend for the Zerion TA Rebalancer. Built to
run on a Pi 3B (or anything Linux with a mic + speaker). The Pi is thin —
it captures audio, transcribes it, and POSTs the transcript to the
rebalancer. The rebalancer's Claude agent runs on the main machine and
talks back as text. No OpenAI bill on the Pi side.

## What you can say

| You | Bablu does |
|---|---|
| "Hey Bablu, what baskets do I have?" | Reads them aloud — name, chain, paused/active |
| "How's Memes doing?" | Value, drift, last rebalance, next tick |
| "What did you do today?" | Summarises recent rebalances |
| "Rebalance the small basket" | Confirms, then fires a manual tick |
| "Pause Memes" / "Resume small" | Toggles a basket |
| "Create a basket called Demo on Solana with SOL and USDC, budget five dollars" | Confirms, creates with equal weights, first allocation fires immediately |

All write actions ask "should I go ahead?" before firing. Say "yes" /
"do it" / "go ahead" to confirm, or "no" / "cancel" / "never mind" to
back out.

## What the LCD shows

```
       ┌─────────────────────────┐
       │     Bablu's face        │   ← morphs through idle / listening /
       │   ◉ ◉                   │     thinking / speaking / happy /
       │    ‿                    │     tx-pending / error / sleeping
       ├─────────────────────────┤
       │ Memes $50 · small $13   │   ← live ticker, refreshes every 30s
       └─────────────────────────┘
```

The ticker pulls from the rebalancer's `/api/baskets` endpoint and shows
basket names + current USD value. The face also auto-reacts to scheduled
cron ticks: flips to `tx-pending` when a rebalance starts and `happy`
when swaps settle.

## Install on the Pi

```bash
# Clone (or rsync from your dev box)
git clone https://github.com/Magicianhax/zerion-ta-rebalancer.git
cd zerion-ta-rebalancer/voice

# Configure
cp .env.example .env
nano .env       # fill in REBALANCER_URL, REBALANCER_TOKEN,
                # ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID

# Install + start (apt deps, venv, pip, systemd, auto-start on boot)
chmod +x install.sh
./install.sh
```

The installer:
- apt-installs portaudio + libsndfile + libopenblas
- creates a venv, pip-installs the Python deps
- copies two systemd unit files into `/etc/systemd/system/`
- enables both for auto-start on boot
- starts them now

After it runs you'll see Bablu's face on the LCD (if your kiosk is
already pointed at `http://127.0.0.1:7779/index.html?kiosk=1`) and the
voice agent listening on the mic.

## .env reference

| Variable | Required | Notes |
|---|---|---|
| `REBALANCER_URL` | yes | Where the rebalancer is reachable, e.g. `http://192.168.1.10:8080` |
| `REBALANCER_TOKEN` | yes | Same value as `ADMIN_PASSWORD` on the rebalancer |
| `ELEVENLABS_API_KEY` | yes | Used for Scribe STT, TTS, and voice isolation |
| `ELEVENLABS_VOICE_ID` | yes | Pick from elevenlabs.io/app/voice-library |
| `VOICE_CHAT_ID` | no | Conversation thread id; default `voice-bablu` |
| `WAKE_THRESHOLD` | no | Fuzzy "bablu" match 0..1. `0` disables wake-word. Default `0.35` |
| `FOLLOW_UP_SECONDS` | no | Window after a reply where wake-word is bypassed. Default `300` |
| `VAD_THRESHOLD` | no | RMS noise floor. Raise if Bablu false-triggers on ambient noise. Default `7000` |
| `VAD_SILENCE_MS` | no | Silence ms to end an utterance. Default `1000` |
| `VAD_MIN_MS` | no | Reject utterances shorter than this. Default `400` |
| `BABLU_USE_ISOLATOR` | no | `1` enables ElevenLabs voice isolator (denoise) before STT. `0` saves 1-2s per turn. Default `0` |
| `FACE_WEBSOCKET_PORT` | no | Default `7780`. Chromium kiosk connects here. |

No OpenAI key needed — the LLM brain runs server-side on the rebalancer
using Claude Code subscription auth.

## Chromium kiosk for the LCD

If you have a small LCD wired to the Pi (Bablu's existing body for
example), make Chromium open the face on boot. Add this line to
`~/.config/lxsession/LXDE-pi/autostart`:

```
@chromium-browser --kiosk --noerrdialogs --disable-infobars --no-first-run --incognito http://127.0.0.1:7779/index.html?kiosk=1
```

## Logs

```bash
sudo journalctl -u zerion-voice.service -f       # voice loop
sudo journalctl -u zerion-face-http.service -f   # face HTTP
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Bablu's face is stuck on listening | Bump `VAD_THRESHOLD` higher. Mic ambient noise is above the threshold. Sample your room: `arecord -D plughw:3,0 -f S16_LE -d 3 /tmp/m.wav && python3 -c "import wave,numpy as np; w=wave.open('/tmp/m.wav'); p=np.frombuffer(w.readframes(w.getnframes()),np.int16); print(int(np.sqrt(np.mean(p.astype(float)**2))))"` — set threshold to ~3x that. |
| "It cannot reach the rebalancer" | Either the rebalancer service is down on your other box or `REBALANCER_URL` is wrong. Check: `curl http://<your-rebalancer-host>:8080/api/health` |
| 401 / SSE keeps reconnecting | `REBALANCER_TOKEN` doesn't match the rebalancer's `ADMIN_PASSWORD`. Update `.env` and restart `zerion-voice.service`. |
| Speech transcribed but no reply | Did you say "Bablu" first? Wake-word gate rejects anything not matching after `FOLLOW_UP_SECONDS` of silence. Drop `WAKE_THRESHOLD` to make the match looser, or set to `0` to disable the gate entirely. |
| `sounddevice.PortAudioError: Error querying device -1` | systemd can't reach PulseAudio. Make sure `XDG_RUNTIME_DIR` and `PULSE_SERVER` env vars are set in the unit (default install does this). |
| Ticker missing from the LCD | Chromium has the old `face.js` cached. Restart: `pkill -f chromium && DISPLAY=:0 chromium-browser --kiosk --incognito "http://127.0.0.1:7779/index.html?kiosk=1&v=$(date +%s)" &` |

## License

MIT, same as the parent rebalancer repo.
