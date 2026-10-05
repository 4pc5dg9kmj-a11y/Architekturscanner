#!/usr/bin/env bash
cd "$(dirname "$0")"
( sleep 2; (xdg-open http://127.0.0.1:8001 || open http://127.0.0.1:8001) >/dev/null 2>&1 ) &
exec .venv/bin/python -m notenscanner.server "$@"
