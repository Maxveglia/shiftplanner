#!/usr/bin/env python3
"""PreToolUse(Bash): cortar las lecturas que más contexto tiran en ShiftPlanner.

Medido sobre 54 sesiones y 378 subagentes (7–28 sep 2026): el contexto se va,
sobre todo, en leer código por Bash — `cat` y `sed -n` de ficheros enteros
(~10M tokens), muchas veces el mismo fichero una y otra vez — y en `git diff` /
`git show` completos (~1,7M). Este hook deniega, con un motivo que le dice al
modelo qué hacer en su lugar:

  1. `cat`/`nl`/`less`, `head -n N`/`tail -n N` o `sed -n 'a,bp'` que sacan más de
     UMBRAL_LINEAS de un fichero de un checkout de ShiftPlanner (sin filtrar la
     salida con una tubería). → índice con sp-outline y tramos con offset/limit.
  2. `git show REV:ruta` de un fichero grande, igual que el anterior.
  3. `git diff` / `git show <commit>` sin `--stat` que cambian más de UMBRAL_DIFF
     líneas. → el motivo trae ya el `--stat`, para pedir fichero a fichero; y si ya
     es de un fichero (`-- ruta`), cómo listar sus trozos y sacar solo los que hacen
     falta (los diffs por fichero sin recortar de los subagentes: ~0,8M tokens).
  4. `railway logs` sin `--lines`/`--since`: se queda en streaming. → sp-logs.
  5. `pytest` en el backend sin `APP_DATABASE_URL` ni sp-test: va a la base
     `shiftplanner`, que tiene el esquema atrasado, y la suite miente.

Todo lo que no entiende lo deja pasar: un guardián roto no puede bloquear. Una
salida encadenada a `| grep`, `| head`, `| wc`… o a un fichero ya está filtrada y
pasa. Registrado en `.claude/settings.json` del repo. Si algún día se registra
también a nivel de usuario (lo decide Max: toca `~/.claude`), esa copia lleva
`--usuario` y se calla cuando el proyecto es un checkout que ya lo registra.
"""

import json
import os
import re
import shlex
import subprocess
import sys

UMBRAL_LINEAS = 600
UMBRAL_DIFF = 600
LECTORES = {"cat", "nl", "less", "more", "bat"}
OPERADORES = {"&&", "||", ";", "|", "&", "|&", ";;", "(", ")"}
SIN_PARCHE = {"--stat", "--shortstat", "--numstat", "--name-only", "--name-status", "--quiet",
              "--exit-code", "-s", "--no-patch", "--summary", "--dirstat", "--check",
              "--compact-summary", "--raw"}
SIN_PARCHE_PREFIJOS = ("--stat=", "--stat-", "--dirstat=", "--output")


def raiz_shiftplanner(d):
    d = os.path.realpath(d)
    for _ in range(20):
        if os.path.isfile(os.path.join(d, "backend", "app", "main.py")) and os.path.isdir(
            os.path.join(d, "frontend", "src", "lib", "schedule")
        ):
            return d
        padre = os.path.dirname(d)
        if padre == d:
            return None
        d = padre
    return None


def contar_lineas(ruta):
    try:
        if os.path.getsize(ruta) < 12_000:
            return 0
        with open(ruta, "rb") as f:
            c = f.read()
    except OSError:
        return 0
    if b"\0" in c[:4096]:
        return 0
    return c.count(b"\n") + (0 if c.endswith(b"\n") else 1)


def outline(raiz):
    propio = os.path.join(raiz, ".claude", "bin", "sp-outline")
    if os.path.isfile(propio):
        return propio
    return os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "bin", "sp-outline")


def segmentos(comando):
    """[(palabras, operador que sigue)] de la primera línea lógica del comando.

    Un heredoc se corta: lo que va dentro no son comandos de shell."""
    if "<<" in comando:
        comando = comando.split("\n", 1)[0]
    # El salto de línea separa comandos como `;` (fuera de comillas, que shlex respeta).
    lex = shlex.shlex(comando, posix=True, punctuation_chars="();<>|&\n")
    lex.whitespace = " \t\r"
    lex.whitespace_split = True
    lex.commenters = ""  # shlex corta en cualquier `#`, también en una URL: se hace abajo
    actual, salida, comentario = [], [], False
    for tok in lex:
        if tok == "\n":
            comentario = False
            if actual:
                salida.append((actual, ";"))
            actual = []
        elif comentario:
            continue
        elif tok.startswith("#"):  # comentario de shell: hasta el final de la línea
            comentario = True
        elif tok in OPERADORES:
            salida.append((actual, tok))
            actual = []
        else:
            actual.append(tok)
    salida.append((actual, ""))
    return [(p, op) for p, op in salida if p]


REDIRECCIONES = {">", ">>", ">|", "&>", "&>>", "<", "<<<"}


def sin_redirecciones(palabras):
    """(palabras sin redirecciones ni sus destinos, ¿la salida estándar va a un fichero?)."""
    limpias, a_fichero, i = [], False, 0
    while i < len(palabras):
        p = palabras[i]
        if p in REDIRECCIONES:
            descriptor = limpias[-1] if limpias and limpias[-1].isdigit() else None
            if descriptor:
                limpias.pop()
            if p in (">", ">>", ">|", "&>", "&>>") and descriptor in (None, "1"):
                a_fichero = True
            i += 2
            continue
        limpias.append(p)
        i += 1
    return limpias, a_fichero


def programa(palabras):
    """Quita asignaciones VAR=valor y envoltorios (env, time, command…)."""
    i = 0
    while i < len(palabras):
        p = palabras[i]
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", p) or p in ("env", "time", "command", "nice", "exec", "sudo"):
            i += 1
            continue
        break
    return palabras[i:]


def motivo_fichero(raiz, ruta, lineas, sacaria, como):
    tok = lineas * 12 // 1000  # ~12 tokens por línea de código
    return (
        f"{como} sacaría {sacaria} de las {lineas} líneas de {os.path.relpath(ruta, raiz)} (~{tok}k tokens"
        f" el fichero entero). Mira primero su índice con `{outline(raiz)} {ruta}` o busca con "
        "`grep -n`, y lee solo el tramo que necesitas (Read con offset/limit, o `sed -n 'a,bp'` de "
        f"menos de {UMBRAL_LINEAS} líneas). Si ya lo leíste en esta sesión, usa lo que tienes en vez "
        "de releerlo."
    )


def revisar_lector(prog, cwd):
    """cat/nl/less/head/tail/sed de un fichero grande de ShiftPlanner."""
    nombre = os.path.basename(prog[0])
    args = prog[1:]
    if nombre in LECTORES:
        ficheros = [a for a in args if not a.startswith("-")]
        limite = None
    elif nombre in ("head", "tail"):
        limite, ficheros, i = 10, [], 0
        while i < len(args):
            a = args[i]
            if a in ("-n", "--lines") and i + 1 < len(args):
                limite = args[i + 1]
                i += 2
                continue
            m = re.match(r"^-(?:n)?(\+?\d+)$", a) or re.match(r"^--lines=(\+?\d+)$", a)
            if m:
                limite = m.group(1)
            elif not a.startswith("-"):
                ficheros.append(a)
            i += 1
        if isinstance(limite, str):
            if limite.startswith("+"):  # tail -n +N: desde la línea N hasta el final
                limite = ("desde", int(limite[1:]))
            else:
                limite = int(limite) if limite.isdigit() else 10
    elif nombre == "sed":
        if "-i" in args or "-e" in args or not any(re.match(r"^-[a-zA-Z]*n[a-zA-Z]*$", a) for a in args):
            return None
        resto = [a for a in args if not a.startswith("-")]
        if len(resto) < 2:
            return None
        m = re.match(r"^\s*(\d+)\s*(?:,\s*(\d+|\$))?\s*p\s*$", resto[0])
        if not m:
            return None  # '/re/p', varios rangos…: no se sabe cuánto saca
        ficheros = resto[1:]
        fin = m.group(2)
        limite = ("rango", int(m.group(1)), int(m.group(1)) if fin is None else (None if fin == "$" else int(fin)))
    else:
        return None
    for f in ficheros:
        ruta = f if os.path.isabs(f) else os.path.join(cwd, os.path.expanduser(f))
        if not os.path.isfile(ruta):
            continue
        raiz = raiz_shiftplanner(os.path.dirname(ruta))
        if raiz is None:
            continue
        lineas = contar_lineas(ruta)
        if not lineas:
            continue
        if limite is None:
            sacaria = lineas
        elif isinstance(limite, int):
            sacaria = min(limite, lineas)
        elif limite[0] == "desde":
            sacaria = lineas - limite[1] + 1
        else:
            fin = limite[2] if limite[2] is not None else lineas
            sacaria = min(fin, lineas) - limite[1] + 1
        if sacaria > UMBRAL_LINEAS:
            return motivo_fichero(raiz, ruta, lineas, sacaria, f"`{nombre}`")
    return None


def git_dir_y_args(prog, cwd):
    args = prog[1:]
    d = cwd
    while args and args[0].startswith("-"):
        if args[0] == "-C" and len(args) > 1:
            d = args[1] if os.path.isabs(args[1]) else os.path.join(cwd, os.path.expanduser(args[1]))
            args = args[2:]
        elif args[0] in ("-c",) and len(args) > 1:
            args = args[2:]
        else:
            args = args[1:]
    return d, args


# El hook corre ANTES de que se apruebe el comando: su git no puede escribir ni ejecutar
# nada. Nada de configuración que lance programas (fsmonitor, diff externo, textconv, gpg
# para las firmas, fetch perezoso) y, del comando, solo revisiones, rutas y estas opciones
# (`--output=f` escribiría un fichero). Y solo se miden diffs ENTRE COMMITS: un diff contra
# el árbol de trabajo refresca `.git/index` y pasa los filtros `clean` de .gitattributes.
OPCIONES_SEGURAS = {"--cached", "--staged", "--merge-base", "-w", "--ignore-all-space", "-b",
                    "--ignore-space-change", "--ignore-blank-lines", "-M", "-C", "-R", "--root",
                    "--first-parent", "-m", "--cc", "--no-renames", "--find-renames"}


def git(d, *args):
    r = subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
         "-c", "log.showSignature=false", "--no-optional-locks", "-C", d, *args],
        capture_output=True, text=True, timeout=4, stdin=subprocess.DEVNULL,
        env={**os.environ, "GIT_NO_LAZY_FETCH": "1", "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"},
    )
    return r.stdout if r.returncode == 0 else None


def solo_seguro(args):
    fuera, tras_separador = [], False
    for a in args:
        if a == "--":
            tras_separador = True
            fuera.append(a)
        elif tras_separador or not a.startswith("-") or a in OPCIONES_SEGURAS:
            fuera.append(a)
    return fuera


def revisar_git(prog, cwd):
    d, args = git_dir_y_args(prog, cwd)
    if not args or args[0] not in ("diff", "show"):
        return None
    raiz = raiz_shiftplanner(d)
    if raiz is None:
        return None
    sub, resto = args[0], args[1:]
    if any(a in SIN_PARCHE or a.startswith(SIN_PARCHE_PREFIJOS) for a in resto):
        return None
    por_fichero = "--" in resto
    # git show REV:ruta → contenido de un fichero
    objetos = [a for a in resto if ":" in a and not a.startswith("-")]
    if sub == "show" and objetos:
        for obj in objetos:
            texto = git(d, "cat-file", "blob", obj)
            if texto and texto.count("\n") > UMBRAL_LINEAS:
                n = texto.count("\n")
                return (
                    f"`git show {obj}` sacaría las {n} líneas del fichero (~{n * 12 // 1000}k tokens). "
                    f"Busca antes con `git grep -n <texto> {obj.split(':')[0]} -- {obj.split(':', 1)[1]}` y saca "
                    f"solo el tramo: `git show {obj} | sed -n 'a,bp'`. Si es la versión actual del "
                    f"fichero, mejor `{outline(raiz)}` sobre el del worktree y Read con offset/limit."
                )
        return None
    limpio = solo_seguro(resto)
    fin = limpio.index("--") if "--" in limpio else len(limpio)
    revs = [a for a in limpio[:fin] if not a.startswith("-")]
    if sub == "diff":
        entre_commits = any(".." in r for r in revs) or len(revs) >= 2
        if not entre_commits or any(a in ("--cached", "--staged") for a in limpio[:fin]):
            return None  # toca el árbol de trabajo o el índice: no se mide
    else:
        if any(".." in r for r in revs):
            return None
        for r in revs or ["HEAD"]:
            padres = git(d, "rev-list", "--parents", "-n", "1", r, "--")
            if padres is None or len(padres.split()) > 2:
                return None  # un merge: git show enseña el diff combinado, casi siempre corto
    base = ["diff", "--no-ext-diff", "--no-textconv", *limpio] if sub == "diff" else [
        "show", "--no-ext-diff", "--no-textconv", "--format=", *limpio]

    def con(opcion):  # la opción va antes del `--`, o git la toma por una ruta
        if "--" in base:
            i = base.index("--")
            return [*base[:i], opcion, *base[i:]]
        return [*base, opcion]

    numstat = git(d, *con("--numstat"))
    if not numstat:
        return None
    total, ficheros = 0, 0
    for linea in numstat.splitlines():
        partes = linea.split("\t")
        if len(partes) >= 3:
            ficheros += 1
            total += sum(int(x) for x in partes[:2] if x.isdigit())
    if total <= UMBRAL_DIFF:
        return None
    if por_fichero:
        rutas = " ".join(resto[resto.index("--") + 1:])
        return (
            f"`git {sub} … -- {rutas}` sacaría {total} líneas cambiadas. Lista antes sus trozos con "
            f"`git {sub} {' '.join(resto)} | grep -n '^@@'` y saca solo los que necesites con "
            "`| sed -n 'a,bp'`. Si el fichero es nuevo o casi todo cambia, lee la versión del worktree "
            f"con `{outline(raiz)}` y Read con offset/limit."
        )
    stat = git(d, *con("--stat=110")) or ""
    stat_lineas = stat.rstrip().splitlines()
    if len(stat_lineas) > 30:
        stat_lineas = stat_lineas[:29] + [f"… ({len(stat_lineas) - 30} ficheros más)", stat_lineas[-1]]
    return (
        f"`git {sub}` sacaría {total} líneas cambiadas en {ficheros} ficheros. Aquí tienes el --stat; "
        "pide solo los ficheros que necesitas con `git "
        f"{sub} {' '.join(resto)} -- <ruta>` (o `| grep`/`| head` para filtrar):\n" + "\n".join(stat_lineas)
    )


def revisar_railway(prog):
    if len(prog) < 2 or os.path.basename(prog[0]) != "railway" or prog[1] != "logs":
        return None
    if any(a in ("-n", "--lines", "--tail", "--since", "--until", "-h", "--help")
           or a.startswith(("--lines=", "--tail=", "--since=", "--until="))
           or re.match(r"^-n=?\d+$", a) for a in prog[2:]):
        return None
    return (
        "`railway logs` sin `--lines` ni `--since` se queda en streaming hasta que salta el timeout y "
        "vuelca todo lo que llegue. Usa `sp-logs` (en `.claude/bin/` de tu worktree; guarda el crudo en un "
        "fichero y resume errores y rutas lentas) o añade `--lines 300`/`--since 1h` y un `--filter`."
    )


def revisar_pytest(prog, comando, cwd):
    b = os.path.basename(prog[0])
    es_pytest = (
        b in ("pytest", "py.test")
        or (b.startswith("python") and prog[1:3] == ["-m", "pytest"])
        or (b in ("uv", "poetry", "pdm", "hatch") and prog[1:2] == ["run"] and "pytest" in prog[2:4])
    )
    if not es_pytest:
        return None
    if "APP_DATABASE_URL" in comando or "sp-test" in comando or "SP_EVALS" in comando:
        return None
    if os.environ.get("APP_DATABASE_URL"):  # la nube las pone en el entorno
        return None
    rutas = [a for a in prog if a.endswith(".py") or "tests" in a]
    if raiz_shiftplanner(cwd) is None and not any(
        raiz_shiftplanner(os.path.dirname(os.path.join(cwd, os.path.expanduser(a)))) for a in rutas
    ):
        return None
    return (
        "pytest en ShiftPlanner sin `APP_DATABASE_URL`/`ADMIN_DATABASE_URL` va a la base `shiftplanner`, "
        "que tiene el esquema atrasado: da una cascada de fallos falsos o ~90 skipped que parecen verde. "
        "Usa `<worktree>/.claude/bin/sp-test -C <worktree> back [tests/…]` (crea y migra tu base, y resume "
        "la salida), o pon las dos variables en el comando como dice la skill entorno-de-pruebas."
    )


def main():
    if "--usuario" in sys.argv:
        # Una sesión arrancada en `~` tiene CLAUDE_PROJECT_DIR=~ y su settings.json es el de
        # usuario: solo callarse cuando el proyecto es un checkout que registra el hook.
        proyecto = os.environ.get("CLAUDE_PROJECT_DIR", "")
        if proyecto and os.path.isfile(os.path.join(proyecto, "backend", "app", "main.py")):
            try:
                with open(os.path.join(proyecto, ".claude", "settings.json"), encoding="utf-8") as f:
                    if "guardia-bash" in f.read():
                        return
            except OSError:
                pass
    datos = json.load(sys.stdin)
    comando = (datos.get("tool_input") or {}).get("command") or ""
    if "SP_ENTERO=1" in comando:  # salida de emergencia explícita
        return
    cwd = datos.get("cwd") or os.getcwd()
    segs = segmentos(comando)
    motivo = None
    for i, (palabras, op) in enumerate(segs):
        palabras, a_fichero = sin_redirecciones(palabras)
        prog = programa(palabras)
        if not prog:
            continue
        if prog[0] == "cd" and len(prog) > 1:
            destino = os.path.expanduser(prog[1])
            cwd = destino if os.path.isabs(destino) else os.path.join(cwd, destino)
            continue
        filtrada = op in ("|", "|&") or a_fichero
        motivo = revisar_railway(prog) or revisar_pytest(prog, comando, cwd)
        if not motivo and not filtrada:
            motivo = revisar_lector(prog, cwd) or (revisar_git(prog, cwd) if os.path.basename(prog[0]) == "git" else None)
        if motivo:
            break
    if motivo:
        json.dump(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": motivo
                    + "\n(Si de verdad necesitas la salida entera, antepón `SP_ENTERO=1 ` al comando.)",
                }
            },
            sys.stdout,
            ensure_ascii=False,
        )


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001 — un guardián roto deja pasar
        pass
    sys.exit(0)
