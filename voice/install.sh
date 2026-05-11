#!/usr/bin/env bash
# One-shot installer for the voice frontend on a Raspberry Pi.
# Run from inside this directory after `cp .env.example .env && nano .env`.
set -euo pipefail

if [ ! -f .env ]; then
  echo "Missing .env — copy from .env.example and fill in keys first." >&2
  exit 1
fi

echo "[1/4] Installing apt deps (sounddevice needs portaudio + libsndfile)…"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  python3 python3-venv python3-pip \
  portaudio19-dev libsndfile1

echo "[2/4] Creating venv + installing Python deps…"
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip -q
./.venv/bin/pip install -e . -q

echo "[3/4] Installing systemd units…"
sudo cp systemd/zerion-voice.service /etc/systemd/system/
sudo cp systemd/zerion-face-http.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable zerion-voice.service zerion-face-http.service

echo "[4/4] Starting services…"
sudo systemctl restart zerion-face-http.service
sudo systemctl restart zerion-voice.service

echo
echo "Done. Live status:"
echo "  sudo journalctl -u zerion-voice.service -f"
echo
echo "If you have an LCD attached, Chromium kiosk should point at:"
echo "  http://127.0.0.1:7779/index.html?kiosk=1"
