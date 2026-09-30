#!/usr/bin/env bash
# SessionStart (compact | resume | clear): devolver al modelo DÓNDE estaba trabajando.
#
# Al compactar, el resumen conserva el objetivo pero suele perder lo concreto:
# la ruta del worktree, la rama, la base de datos propia, la PR. La sesión
# siguiente lo vuelve a buscar (o, peor, trabaja en BASE o en otro worktree).
# Este hook lo reconstruye de la realidad, no de la memoria del modelo:
#
#   - los worktrees de manager-opt que viven en el scratchpad de ESTA sesión
#     (la ruta del scratchpad lleva el session_id), con su rama, cuánto va por
#     delante/detrás de origin/main y cuántos ficheros sin commitear;
#   - la nota de traspaso `<scratchpad>/traspaso.md` si existe (skill `traspaso`);
#   - en `clear` (sesión nueva, scratchpad nuevo), las notas de traspaso de las
#     últimas 12 h de otras sesiones, para poder retomarlas.
#
# Sale en silencio si no hay nada de ShiftPlanner que contar: no gasta contexto
# en sesiones de otros proyectos. Nunca hace red (ni `git fetch`) para no
# retrasar el arranque. Registrado en el repo; si Max lo registra también a nivel
# de usuario, esa copia lleva `--usuario` y se calla si el proyecto ya lo registra.
set -u

usuario=0
[ "${1:-}" = "--usuario" ] && usuario=1
if [ "$usuario" = 1 ] && [ -f "${CLAUDE_PROJECT_DIR:-/nada}/backend/app/main.py" ] &&
  grep -q 'estado-sesion' "$CLAUDE_PROJECT_DIR/.claude/settings.json" 2>/dev/null; then
  exit 0
fi

entrada="$(cat)"
campo() { printf '%s' "$entrada" | python3 -c "import json,sys; print(json.load(sys.stdin).get('$1') or '')" 2>/dev/null; }
sid="$(campo session_id)"
origen="$(campo source)"
[ -n "$sid" ] || exit 0

base="${SP_BASE:-$HOME/conductor/repos/manager-opt}"

# El scratchpad de esta sesión: /private/tmp/claude-<uid>/<proyecto>/<sid>/scratchpad
scratch=""
for d in /private/tmp/claude-*/*/"$sid"/scratchpad /tmp/claude-*/*/"$sid"/scratchpad; do
  [ -d "$d" ] && scratch="$d" && break
done

salida=""
linea() { salida="$salida$1
"; }

if [ -n "$scratch" ] && [ -d "$base/.git" ]; then
  real="$(cd "$scratch" && pwd -P)"
  git -C "$base" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print substr($0,10)}' |
    while IFS= read -r wt; do
      case "$wt" in "$scratch"/* | "$real"/*) ;; *) continue ;; esac
      [ -d "$wt" ] || continue
      rama="$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null)"
      cuenta="$(git -C "$wt" rev-list --left-right --count origin/main...HEAD 2>/dev/null)"
      detras="${cuenta%%	*}"
      delante="${cuenta##*	}"
      sucios="$(git -C "$wt" status --porcelain 2>/dev/null | grep -c .)"
      bd=""
      [ -x "$wt/.claude/bin/sp-test" ] && bd="$("$wt/.claude/bin/sp-test" -C "$wt" bd 2>/dev/null)"
      echo "- $wt · rama $rama · $delante commits por delante y $detras por detrás de origin/main (sin fetch) · $sucios ficheros sin commitear${bd:+ · base de pruebas $bd}"
    done >"$scratch/.estado-worktrees" 2>/dev/null
  if [ -s "$scratch/.estado-worktrees" ]; then
    linea "ShiftPlanner · worktrees de esta sesión (reconstruido de git tras «${origen}»):"
    salida="$salida$(cat "$scratch/.estado-worktrees")
"
    linea "Trabaja ahí, nunca en $base (solo fetch, worktree y railway). Tests: <worktree>/.claude/bin/sp-test."
  fi
  rm -f "$scratch/.estado-worktrees"
fi
if [ -n "$scratch" ]; then
  if [ -s "$scratch/traspaso.md" ]; then
    linea ""
    linea "Nota de traspaso de esta sesión ($scratch/traspaso.md):"
    salida="$salida$(head -c 6000 "$scratch/traspaso.md")
"
  fi
fi

if [ "$origen" = "clear" ]; then
  otras="$(find /private/tmp/claude-*/*/*/scratchpad /tmp/claude-*/*/*/scratchpad -maxdepth 1 -name traspaso.md -mmin -720 2>/dev/null |
    grep -v "/$sid/" | head -3)"
  if [ -n "$otras" ]; then
    linea "Notas de traspaso recientes de ShiftPlanner (léelas solo si Max pide retomar ese trabajo):"
    while IFS= read -r n; do
      linea "- $n — $(grep -m1 -v '^\s*$' "$n" | cut -c1-120)"
    done <<EOF
$otras
EOF
  fi
fi

[ -n "$salida" ] && printf '%s' "$salida"
exit 0
