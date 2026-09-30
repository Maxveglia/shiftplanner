#!/usr/bin/env bash
# SessionEnd hook: distil what went wrong (or right) in a Claude Code session on
# ShiftPlanner into notes on the orphan `learnings` branch. The weekly routine
# (.claude/routine/weekly-tuning.md) turns those notes into skill/agent changes.
#
# Registered twice on purpose:
#   - project: .claude/settings.json, for sessions started inside a checkout;
#   - user:    ~/.claude/settings.json via install-user-hook.sh, because most
#              sessions start in $HOME and work in scratchpad worktrees, where
#              project settings never load. That copy only acts on sessions
#              that clearly touched manager-opt.
# A per-session marker makes the second registration a no-op.
#
# Written for macOS /bin/bash 3.2: no associative arrays, no `timeout`.
#
# Manual run (prints the note, commits nothing, stays in the foreground):
#   echo '{"session_id":"<id>","transcript_path":"<file.jsonl>"}' \
#     | SP_LEARNING_DRY_RUN=1 .claude/hooks/capture-learnings.sh

set -u

# The `claude -p` below ends a session of its own; without this guard it would
# fire this very hook again.
[ "${SP_LEARNING_HOOK:-}" = "1" ] && exit 0

# Cloud sessions load this repo's hooks too, the weekly routine among them. The
# routine consumes the notes; it must not write notes about itself.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$SCRIPT_DIR/hook.log"
MAX_BYTES=150000     # what the extractor gets, at most
MIN_BYTES=1500       # below this the session had nothing to learn from
MIN_MENTIONS=3       # user-level copy: lines mentioning manager-opt to count as ShiftPlanner
EXTRACT_TIMEOUT=300  # seconds

INPUT="$(cat)"
SID_SHORT="?"

log() {
  printf '%s [%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$SID_SHORT" "$*" >> "$LOG" 2>/dev/null
}

# `timeout` is not on macOS; perl's alarm survives the exec.
with_timeout() {
  local secs="$1"; shift
  perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$secs" "$@"
}

# Directory mutex. flock(1) is not on macOS either.
acquire() {
  local lock="$1" waited=0
  while ! mkdir "$lock" 2>/dev/null; do
    # A holder that died leaves the directory behind; ten minutes is far past
    # any real commit + push.
    if [ -n "$(find "$lock" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
      rmdir "$lock" 2>/dev/null
      continue
    fi
    [ "$waited" -ge 120 ] && return 1
    sleep 1; waited=$((waited + 1))
  done
}

release() { [ -n "$1" ] && rmdir "$1" 2>/dev/null; return 0; }

# Condensed transcript: what Max wrote, what Claude answered, which tools,
# skills and agents it used, and tool errors. Tool output and thinking are ~70%
# of a transcript and say little about how instructions performed.
condense() {
  jq -R -r '
    def clip($n): if length > $n then .[0:$n] + "…" else . end;
    def clean:
      gsub("<system-reminder>[\\s\\S]*?</system-reminder>"; "")
      | gsub("<task-notification>[\\s\\S]*?</task-notification>"; "[aviso de tarea en segundo plano]")
      | gsub("^\\s+|\\s+$"; "");
    def result_text:
      if type == "array" then map(.text? // "") | join(" ") else tostring end;

    fromjson?
    | select(.isSidechain != true)
    | if .type == "user" and .isMeta != true then
        ( .message.content
          | if type == "string" then "USUARIO: " + (clean | clip(2000))
            else .[]
              | if .type == "text" then "USUARIO: " + (.text | clean | clip(2000))
                elif .type == "tool_result" and .is_error == true
                  then "[error de herramienta] " + (.content | result_text | clean | clip(300))
                else empty end
            end )
      elif .type == "assistant" then
        ( .message.content[]?
          | if .type == "text" then "CLAUDE: " + (.text | clean | clip(3000))
            elif .type == "tool_use" then
              if .name == "Skill" then "[skill: \(.input.skill // "?")]"
              elif .name == "Agent" or .name == "Task"
                then "[agente: \(.input.subagent_type // "general-purpose") — \(.input.description // "")]"
              elif .name == "Bash"
                then "[Bash: \((.input.description // .input.command // "") | tostring | clip(160))]"
              elif (.input.file_path? // null) != null then "[\(.name): \(.input.file_path)]"
              else "[\(.name)]" end
            else empty end )
      else empty end
    | select(. != "USUARIO: " and . != "CLAUDE: ")
  '
}

# One text-in, text-out call to Haiku. Neutral cwd, no tools, no persistence,
# user settings only: it never loads the repo's CLAUDE.md or hooks. CLAUDECODE
# is unset so the nested CLI does not think it runs inside another session.
# $1 is a system prompt file, or the prompt itself when it is not a file.
haiku() {
  local system="$1" neutral out rc
  neutral="$(mktemp -d "${TMPDIR:-/tmp}/sp-learnings.XXXXXX")" || return 1
  local flag=--system-prompt
  [ -f "$system" ] && flag=--system-prompt-file
  out="$(
    cd "$neutral" || exit 1
    unset CLAUDECODE
    export SP_LEARNING_HOOK=1
    with_timeout "$EXTRACT_TIMEOUT" \
      claude -p --model haiku --no-session-persistence --tools "" \
        --setting-sources user "$flag" "$system" 2>>"$LOG"
  )"
  rc=$?
  rm -rf "$neutral"
  printf '%s\n' "$out"
  return $rc
}

# The extractor is asked not to name anyone, and in testing it still did
# ("Hugo (20h)"). A second call whose only job is anonymising is far more
# reliable than one instruction among many.
ANONYMIZE_PROMPT='Recibes notas en markdown. Devuélvelas exactamente iguales, carácter por carácter, con un único cambio: todo nombre propio de persona (nombre o apellido, también de datos de prueba o de ejemplo) que no sea Max, Xavi o Claude se sustituye por su puesto si el texto lo dice, o por «un empleado» / «una empleada». Quita también emails, teléfonos, claves y el horario de personas concretas. No añadas ni quites entradas, no expliques nada, no uses bloques de código. Si no hay nada que cambiar, devuelve el texto tal cual.'

# Belt and braces: the prompts already forbid all of this.
redact() {
  perl -pe '
    s/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[email]/g;
    s/sk-ant-[A-Za-z0-9_-]+/[secreto]/g;
    s/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}/[secreto]/g;
    s/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/[secreto]/g;
    s{(\w+(?:\+\w+)?://[^:/@\s]+):[^@\s]+@}{$1:[secreto]@}g;
    s/(Bearer\s+)[A-Za-z0-9._~+\/-]{16,}/$1\[secreto]/gi;
    s/((?:api[_-]?key|token|secret|password|passwd)["\x27]?\s*[:=]\s*["\x27]?)[^\s"\x27,]{8,}/$1\[secreto]/gi;
  '
}

main() {
  local sid transcript cwd
  sid="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)"
  transcript="$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)"
  cwd="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)"
  [ -n "$sid" ] || { log "entrada sin session_id"; return; }
  SID_SHORT="${sid:0:8}"

  if [ -z "$transcript" ] || [ ! -f "$transcript" ]; then
    transcript="$(find "$HOME/.claude/projects" -maxdepth 2 -name "$sid.jsonl" -print 2>/dev/null | head -1)"
  fi
  [ -f "$transcript" ] || { log "no encuentro el transcript"; return; }

  # Which repo? A checkout of it when registered at project level; the shared
  # Conductor clone for the user-level copy (not a git repo itself).
  local repo mode common
  if common="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; then
    mode=project
    repo="$(dirname "$common")"
  else
    mode=user
    repo="${SP_REPO_DIR:-$HOME/conductor/repos/manager-opt}"
    common="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
      || { log "no encuentro el repo en $repo"; return; }
    case "$cwd" in
      *manager-opt*) ;;
      *)
        local mentions
        mentions="$(grep -c -i 'manager-opt' "$transcript" 2>/dev/null)"
        [ "${mentions:-0}" -ge "$MIN_MENTIONS" ] || return 0
        ;;
    esac
  fi
  local learn_wt="${SP_LEARNINGS_DIR:-$(dirname "$repo")/.shiftplanner-learnings}"
  local state="$common/sp-learnings"
  mkdir -p "$state/offsets" "$state/rejected" 2>/dev/null

  # Both registrations fire for a session started inside a checkout, and a
  # resumed session ends more than once: remember how far each one was read.
  local session_lock="" offset=0 size
  if [ -z "${SP_LEARNING_DRY_RUN:-}" ]; then
    session_lock="$state/session-$sid.lock"
    acquire "$session_lock" || { log "otra copia del hook procesa esta sesión"; return; }
    offset="$(cat "$state/offsets/$sid" 2>/dev/null || echo 0)"
  fi
  size="$(wc -c < "$transcript" | tr -d ' ')"
  if [ "$size" -le "$offset" ]; then release "$session_lock"; return 0; fi

  local condensed
  condensed="$(tail -c +$((offset + 1)) "$transcript" | condense)"
  if [ "${#condensed}" -gt "$MAX_BYTES" ]; then
    condensed="$(printf '%s\n' "$condensed" | tail -c "$MAX_BYTES" | tail -n +2)"
  fi
  if [ "${#condensed}" -lt "$MIN_BYTES" ]; then
    log "sesión sin contenido suficiente (${#condensed} bytes, $mode)"
    [ -z "${SP_LEARNING_DRY_RUN:-}" ] && echo "$size" > "$state/offsets/$sid"
    release "$session_lock"
    return 0
  fi

  # The names the extractor may attribute a note to: this checkout's when run
  # from one, main's for the user-level copy.
  local names today
  if [ "$mode" = project ]; then
    names="$( { ls -1 "$SCRIPT_DIR/../skills" 2>/dev/null | sed 's/^/skill: /'
                ls -1 "$SCRIPT_DIR/../agents" 2>/dev/null | sed -n 's/\.md$//p' | sed 's/^/agente: /'; } )"
  else
    names="$(git -C "$repo" ls-tree --name-only origin/main .claude/skills/ .claude/agents/ 2>/dev/null \
              | sed -e 's#^\.claude/skills/#skill: #' -e 's#^\.claude/agents/\(.*\)\.md$#agente: \1#' \
              | grep -E '^(skill|agente): ')"
  fi
  names="$(printf '%s\n' "$names" | grep -v '^$' | paste -sd ',' - | sed 's/,/, /g')"
  today="$(date +%F)"

  local note
  if ! note="$(
    {
      printf 'FECHA: %s\nSESIÓN: %s\nSKILLS Y AGENTES DEL REPO: %s\n\n--- SESIÓN CONDENSADA ---\n' \
        "$today" "$SID_SHORT" "${names:-ninguno}"
      printf '%s\n' "$condensed"
    } | haiku "$SCRIPT_DIR/extract-prompt.md"
  )"; then
    log "claude -p falló al extraer"
    release "$session_lock"
    return
  fi

  # Keep from the first entry on; anything before it is chatter.
  note="$(printf '%s\n' "$note" | sed -n '/^### /,$p')"
  if [ -n "$(printf '%s' "$note" | tr -d '[:space:]')" ]; then
    local entries_before entries_after anonymized
    entries_before="$(printf '%s\n' "$note" | grep -c '^### ')"
    if ! anonymized="$(printf '%s\n' "$note" | haiku "$ANONYMIZE_PROMPT")"; then
      log "claude -p falló al anonimizar; descarto la nota"
      release "$session_lock"
      return
    fi
    anonymized="$(printf '%s\n' "$anonymized" | sed -n '/^### /,$p')"
    entries_after="$(printf '%s\n' "$anonymized" | grep -c '^### ')"
    # The pass must only rewrite words. Anything else and the note is not
    # trusted with GitHub.
    if [ "$entries_after" != "$entries_before" ]; then
      printf '%s\n' "$note" > "$state/rejected/$sid.md"
      log "la anonimización cambió el número de entradas ($entries_before → $entries_after); descartada"
      release "$session_lock"
      return
    fi
    note="$anonymized"
  fi
  note="$(printf '%s\n' "$note" | redact)"
  if [ -z "$(printf '%s' "$note" | tr -d '[:space:]')" ]; then
    log "sin aprendizajes ($mode, ${#condensed} bytes)"
    [ -z "${SP_LEARNING_DRY_RUN:-}" ] && echo "$size" > "$state/offsets/$sid"
    release "$session_lock"
    [ -n "${SP_LEARNING_DRY_RUN:-}" ] && echo "NONE"
    return 0
  fi
  if ! printf '%s\n' "$note" | grep -Eq '^### [0-9]{4}-[0-9]{2}-[0-9]{2} \| (skill|agente): '; then
    printf '%s\n' "$note" > "$state/rejected/$sid.md"
    log "salida con formato inválido; guardada en $state/rejected/$sid.md"
    release "$session_lock"
    return
  fi

  if [ -n "${SP_LEARNING_DRY_RUN:-}" ]; then
    printf '%s\n' "$note"
    return 0
  fi

  # Everything below writes to the learnings worktree, shared by every session
  # that ends on this Mac; most of them overlap with another one.
  export GIT_TERMINAL_PROMPT=0
  local git_lock="$state/git.lock"
  acquire "$git_lock" || { log "el candado de git no se libera"; release "$session_lock"; return; }

  if [ ! -d "$learn_wt" ]; then
    git -C "$repo" fetch -q origin learnings >>"$LOG" 2>&1
    git -C "$repo" worktree add -q "$learn_wt" learnings >>"$LOG" 2>&1 \
      || { log "no pude crear el worktree $learn_wt"; release "$git_lock"; release "$session_lock"; return; }
  fi

  if ! git -C "$learn_wt" pull -q --rebase --autostash origin learnings >>"$LOG" 2>&1; then
    git -C "$learn_wt" rebase --abort >/dev/null 2>&1
    log "pull falló; escribo sobre la copia local"
  fi

  local week file
  week="$(date +%G-W%V)"
  file="$learn_wt/$week.md"
  [ -f "$file" ] || printf '# Aprendizajes · semana %s\n' "$week" > "$file"
  printf '\n<!-- sesión %s · %s · %s -->\n%s\n' "$SID_SHORT" "$(date '+%F %H:%M')" "$mode" "$note" >> "$file"

  if git -C "$learn_wt" add -- "$week.md" \
     && git -C "$learn_wt" commit -q -m "learnings: $SID_SHORT" -- "$week.md" >>"$LOG" 2>&1; then
    echo "$size" > "$state/offsets/$sid"
    if git -C "$learn_wt" push -q origin learnings >>"$LOG" 2>&1; then
      log "nota guardada en $week.md y subida ($mode)"
    else
      log "push falló; el commit queda en local y saldrá con el siguiente"
    fi
  else
    log "commit falló en $learn_wt"
  fi

  release "$git_lock"
  release "$session_lock"
}

if [ -n "${SP_LEARNING_DRY_RUN:-}" ] || [ -n "${SP_LEARNING_FOREGROUND:-}" ]; then
  main
else
  # SessionEnd hooks share a budget of a second or two; the extraction takes
  # tens of seconds. Detach and let the session close.
  ( main ) </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null
fi
exit 0
