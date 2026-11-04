#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

browser="${CHROME:-}"
if [ -z "$browser" ]; then
  for candidate in \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"; do
    if [ -x "$candidate" ]; then
      browser="$candidate"
      break
    fi
  done
fi

if [ -z "$browser" ]; then
  echo "No Chromium-based browser found. Set CHROME=/path/to/browser." >&2
  exit 1
fi

"$browser" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1200,630 \
  --screenshot="$PWD/public/og.png" "file://$PWD/scripts/og-card.html"

echo "Wrote public/og.png"
