#!/usr/bin/env bash
# Notenscanner installieren (Linux/macOS)
set -e
cd "$(dirname "$0")"
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip install --no-deps "basic-pitch==0.4.0"
echo
echo "Fertig. Starten mit:  ./start.sh   (Weboberflaeche)"
echo "oder:                 .venv/bin/python -m notenscanner lied.mp3"
