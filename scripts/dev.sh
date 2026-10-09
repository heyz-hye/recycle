#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v npm >/dev/null; then
  echo 'Install Node.js 22 (includes npm), then run this script again.' >&2
  exit 1
fi
if ! node -e 'if(Number(process.versions.node.split(".")[0])<22) process.exit(1)' 2>/dev/null; then
  if [ ! -x .tools/node_modules/node/bin/node ]; then
    npm install --prefix .tools node@22 --no-audit --no-fund
  fi
  export PATH="$PWD/.tools/node_modules/node/bin:$PATH"
fi
if [ ! -x .venv/bin/python ]; then
  if command -v uv >/dev/null; then
    uv venv --python 3.12 .venv
  else
    python3.12 -m venv .venv
  fi
fi
if command -v uv >/dev/null; then
  uv pip install --python .venv/bin/python -r backend/requirements.lock
else
  .venv/bin/python -m pip install -r backend/requirements.lock
fi
npm ci --prefix frontend --no-audit --no-fund
export PYTHONPATH="$PWD/backend"
export NEXT_TELEMETRY_DISABLED=1
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --timeout-keep-alive 65 &
api_pid=$!
cleanup() { kill "$api_pid" "${web_pid:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
npm run dev --prefix frontend &
web_pid=$!
echo 'LoopMint: http://localhost:3000 · API docs: http://127.0.0.1:8000/docs'
wait "$web_pid"
