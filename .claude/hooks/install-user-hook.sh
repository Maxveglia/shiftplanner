#!/usr/bin/env bash
# Install the learnings hook at USER level, so it also runs for sessions started
# outside a checkout of this repo (most of them: they start in $HOME and work in
# scratchpad worktrees, where .claude/settings.json never loads).
#
# Copies capture-learnings.sh and extract-prompt.md to ~/.claude/hooks/shiftplanner/
# and registers that copy under SessionEnd in ~/.claude/settings.json. Idempotent:
# run it again after either file changes on main.
set -euo pipefail

src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="$HOME/.claude/hooks/shiftplanner"
settings="$HOME/.claude/settings.json"
command="$dest/capture-learnings.sh"

mkdir -p "$dest"
cp "$src/capture-learnings.sh" "$src/extract-prompt.md" "$dest/"
chmod +x "$command"

[ -f "$settings" ] || echo '{}' > "$settings"
if jq -e --arg c "$command" \
     '[.hooks.SessionEnd[]?.hooks[]? | select(.command == $c)] | length > 0' \
     "$settings" >/dev/null; then
  echo "Ya registrado en $settings; archivos actualizados en $dest."
  exit 0
fi

cp "$settings" "$settings.bak-$(date +%Y%m%d%H%M%S)"
tmp="$(mktemp)"
jq --arg c "$command" '
  .hooks //= {}
  | .hooks.SessionEnd //= []
  | .hooks.SessionEnd += [{"hooks": [{"type": "command", "command": $c, "timeout": 10}]}]
' "$settings" > "$tmp"
jq -e . "$tmp" >/dev/null
mv "$tmp" "$settings"
echo "Registrado en $settings (copia de seguridad al lado) y archivos copiados a $dest."
