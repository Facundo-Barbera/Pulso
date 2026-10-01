#!/usr/bin/env bash
# Run the engine and the tailnet proxy as macOS LaunchAgents, like Delta's
# engine: they start at login, restart if they die, and don't go down when Telar
# (or a terminal) restarts. The phone and TestFlight builds depend on both.
#
#   scripts/launchd.sh install     write both agents and start them
#   scripts/launchd.sh uninstall   stop and remove them (back to `bun run dev` in a terminal)
#   scripts/launchd.sh status
#
# Logs: ~/Library/Logs/Pulso/. The engine runs `next dev` from this checkout, so a
# merged change is live without a restart.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/Pulso"
LABELS=(com.bixku.pulso.engine com.bixku.pulso.tailnet)

plist() {
  local label="$1" workdir="$2"; shift 2
  local args=""
  for arg in "$@"; do args+="    <string>$arg</string>"$'\n'; done
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
$args  </array>
  <key>WorkingDirectory</key>
  <string>$workdir</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "$BUN"):/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>$HOME</string>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOGS/$label.log</string>
  <key>StandardErrorPath</key>
  <string>$LOGS/$label.log</string>
</dict>
</plist>
EOF
}

case "${1:-status}" in
  install)
    mkdir -p "$AGENTS" "$LOGS"
    plist com.bixku.pulso.engine "$ROOT/apps/engine" "$BUN" --bun next dev --hostname 127.0.0.1 --port 3230 > "$AGENTS/com.bixku.pulso.engine.plist"
    plist com.bixku.pulso.tailnet "$ROOT" "$BUN" "$ROOT/apps/engine/scripts/tailnet-proxy.mjs" > "$AGENTS/com.bixku.pulso.tailnet.plist"
    for label in "${LABELS[@]}"; do
      launchctl bootout "gui/$UID/$label" 2>/dev/null || true
      launchctl bootstrap "gui/$UID" "$AGENTS/$label.plist"
      echo "started $label"
    done
    ;;
  uninstall)
    for label in "${LABELS[@]}"; do
      launchctl bootout "gui/$UID/$label" 2>/dev/null || true
      rm -f "$AGENTS/$label.plist"
      echo "removed $label"
    done
    ;;
  status)
    for label in "${LABELS[@]}"; do
      launchctl print "gui/$UID/$label" 2>/dev/null | grep -E "^\s+(state|pid) =" | sed "s/^/$label: /" || echo "$label: not installed"
    done
    ;;
  *) echo "usage: $(basename "$0") install | uninstall | status" >&2; exit 2 ;;
esac
