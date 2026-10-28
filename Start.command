#!/bin/bash
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is needed to open Folio in a local page."
  echo "You can still open index.html for pictures, merge, and page size."
  read -r -p "Press return to close."
  exit 1
fi
PORT="$(python3 - <<'PY'
import socket
port = 8765
while port < 8800:
    sock = socket.socket()
    try:
        sock.bind(("127.0.0.1", port))
    except OSError:
        port += 1
        continue
    sock.close()
    print(port)
    break
PY
)"
URL="http://127.0.0.1:${PORT}/"
echo "Folio is at ${URL}"
echo "Leave this window open while you use it. Press Ctrl+C to stop."
(sleep 0.7 && open "$URL") &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
