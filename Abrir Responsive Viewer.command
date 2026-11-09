#!/usr/bin/env bash
# Acceso directo de doble clic para levantar Responsive Viewer y abrir el navegador.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/app.py" ]; then
  DIR="$SCRIPT_DIR"
else
  DIR="/Users/miguellazarosantiago/Documents/Tools/DevTool"
fi

cd "$DIR"
mkdir -p "$DIR/.certs"

PORT=5050
URL="http://127.0.0.1:${PORT}"

if ! /usr/bin/curl -s -o /dev/null --max-time 1 "${URL}/api/cert"; then
  if [ ! -x "$DIR/.venv/bin/python" ]; then
    "$DIR/install.sh"
  fi
  /usr/bin/nohup "$DIR/.venv/bin/python" "$DIR/app.py" --port "$PORT" --no-browser > "$DIR/.certs/server.log" 2>&1 &
  for _ in $(seq 1 25); do
    if /usr/bin/curl -s -o /dev/null --max-time 1 "${URL}/api/cert"; then
      break
    fi
    /bin/sleep 0.2
  done
fi

/usr/bin/open "$URL"
exit 0
