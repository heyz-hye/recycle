#!/usr/bin/env bash
# Isolated wallet preview; environment must point at a separate Devnet database.
set -euo pipefail
cd "$(dirname "$0")/.."
preview_env="${1:-.data/devnet.env}"
if [[ ! -f "$preview_env" ]]; then
  echo 'Create .data/devnet.env using docs/WALLETS_AND_CONVERSIONS.md first.' >&2
  exit 1
fi
if [[ -x .tools/node_modules/node/bin/node ]]; then
  export PATH="$PWD/.tools/node_modules/node/bin:$PATH"
fi
export PYTHONPATH="$PWD/backend"
.venv/bin/python -m uvicorn app.main:app --env-file "$preview_env" \
  --host 127.0.0.1 --port 8002 --timeout-keep-alive 65 &
api_pid=$!
cleanup() { kill "$api_pid" "${worker_pid:-}" "${web_pid:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
.venv/bin/python -c 'import sys, runpy; from dotenv import load_dotenv; load_dotenv(sys.argv[1], override=True); runpy.run_module("app.worker", run_name="__main__")' "$preview_env" &
worker_pid=$!
API_URL=http://127.0.0.1:8002 NEXT_DIST_DIR=.next-test/devnet NEXT_TELEMETRY_DISABLED=1 \
  npm run dev --prefix frontend -- --port 3002 &
web_pid=$!
echo 'Devnet wallet preview: http://localhost:3002 (set PUBLIC_ORIGIN to this URL)'
wait "$web_pid"
