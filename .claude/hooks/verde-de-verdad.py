#!/usr/bin/env python3
"""Stop: verde-de-verdad. No se termina un turno con código de ShiftPlanner sin probar.

Regla: el agente principal no puede terminar si, desde lo último que se aprobó, cambió
código de ShiftPlanner y no hay una ejecución COMPLETA de sp-test con `VALE: sí` y 0
fallos sobre EXACTAMENTE ese estado del código. Casi todos los incidentes de ShiftPlanner
eran reglas que dependían de que el agente se acordara (93 tests saltados sin Postgres que
parecían verdes…). La memoria documenta; el hook garantiza.

  - Código: `backend/` e `infra/` exigen `back`; `frontend/` exige `front` Y `tsc` (`todo`
    cubre los tres). Nada más (`.claude/`, docs de raíz…) exige nada.
  - Huella: el árbol git de cada subárbol tal y como está en DISCO (`.claude/bin/sp-huella`,
    la misma que usa sp-test al empezar cada suite). Se calcula con el sp-huella del propio
    checkout si lo tiene (el mismo que usa su sp-test) y, si no, con el de este hook. Cada
    huella lleva versión (`huella_v`): constancias o líneas base de otra versión no valen.
  - Constancia: sp-test deja `<git-common-dir>/sp-logs/<wt>-<hash>/verde-<suite>.json`
    (`verde-<suite>-parcial.json` si llevó argumentos: no abre la puerta).
  - Línea base («lo aprobado»): POR CHECKOUT y persistente entre sesiones, en
    `<git-common-dir>/sp-verde/bases/<sha1 de la ruta física>.json`. Solo la escribe un Stop
    que deja terminar con todo verificado o sin cambios (nunca la salida honesta ni el
    tope). SessionStart (`--inicio`) solo la crea para el checkout de cwd si aún no tiene
    (el perdón único al instalar); si ya tiene, no la toca. Así, /clear, compactar o
    reanudar no perdonan nada.
  - Checkout sin línea base visto a mitad de sesión: la referencia es `HEAD@{inicio de la
    sesión}`; si el checkout no existía entonces, el commit con el que se creó (la entrada
    más vieja de su reflog). Lo commiteado en la sesión y lo no commiteado cuentan como
    cambio; revisar una PR ajena sin tocarla no exige nada.
  - Estado de la sesión (hora de inicio, checkouts vistos, bloqueos seguidos) en
    `${SP_VERDE_ESTADO:-${XDG_STATE_HOME:-~/.local/state}/sp-verde}/sesiones/<session_id>.json`:
    depende solo del session_id, no de por dónde ande el cwd.
  - Checkouts que mira: el de `cwd`, el de `$CLAUDE_PROJECT_DIR`, los vistos en la sesión
    (cada SessionStart y cada Stop apuntan el de cwd), los worktrees del scratchpad de ESTA
    sesión (`scratchpad_dir` o, si falta, la ruta con el session_id) y los de
    `<repo>/.claude/worktrees/` creados después de empezar la sesión. Checkout = lo mismo que
    `es_checkout` de sp-test: `backend/app/main.py` y `frontend/src`.
  - Salidas honestas: si alguna línea del último mensaje EMPIEZA por `BLOQUEADO:` o
    `PREGUNTA:` (sin distinguir mayúsculas; admite `**…**`, `> `, `- `), deja terminar SIN
    aprobar nada. Igual si el turno acaba para esperar un subagente, un workflow o un sp-test
    (`…/.claude/bin/sp-test`) en segundo plano: la puerta vuelve a mirar al despertar.
  - Tope: al 5.º intento seguido que habría bloqueado, deja terminar con un systemMessage
    para Max (Claude Code anula un Stop hook tras 8 bloqueos seguidos). El contador vuelve
    a 0 cuando `stop_hook_active` es false (turno nuevo) o cuando se deja terminar.

Aceptado y documentado: una sesión reanudada con cambios sin aprobar de turnos anteriores
bloquea una vez (V-F02); un JSON de constancia forjado a mano es mala fe y queda fuera; un
subagente eterno en segundo plano solo aplaza la puerta, no la abre.

Un guardián roto no puede bloquear: cualquier error interno deja pasar (exit 0, sin
salida). No se registra en SubagentStop (bloquearía a revisores de solo lectura): lo que
cambie un subagente lo pilla el Stop del hilo principal. Igual en la nube y en `claude -p`.
Tests: python3 .claude/hooks/tests/test_verde_de_verdad.py
"""

import datetime
import glob
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
import time

TOPE = 5
SUBARBOLES = ("backend", "infra", "frontend")
EXIGE = {"backend": ("back",), "infra": ("back",), "frontend": ("front", "tsc")}
CUBRE = {"back": ("backend", "infra"), "front": ("frontend",), "tsc": ("frontend",)}
ORDEN = ("back", "front", "tsc")
HONESTA = re.compile(r"^[ \t]*(?:(?:>|[-*+]|\d+[.)])[ \t]+)*[*_`]*(?:BLOQUEADO|PREGUNTA)[*_`]*[ \t]*:",
                     re.IGNORECASE | re.MULTILINE)
SP_TEST_PROG = re.compile(r"(?:^|/)\.claude/bin/sp-test$")
ENVOLTORIOS = {"env", "nohup", "time", "caffeinate", "exec", "command", "nice", "bash", "sh", "zsh"}
OPERADORES = {";", "&&", "||", "|", "|&", "&", "(", ")", ";;"}
BIN = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bin")
DIAS_SESION = 30


# --- git y checkouts -----------------------------------------------------------------------

def entorno_git():
    e = dict(os.environ)
    for k in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX"):
        e.pop(k, None)
    return e


def git(d, *args):
    try:
        r = subprocess.run(["git", "--no-optional-locks", "-C", d, *args], capture_output=True, text=True,
                           timeout=10, env=entorno_git())
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def es_checkout(d):
    return os.path.isfile(os.path.join(d, "backend", "app", "main.py")) and os.path.isdir(
        os.path.join(d, "frontend", "src"))


def checkout_de(d):
    if not d or not isinstance(d, str) or not os.path.isdir(d):
        return None
    top = git(d, "rev-parse", "--show-toplevel")
    if top and es_checkout(top):
        return os.path.realpath(top)
    return None


def dentro(ruta, carpeta):
    return ruta == carpeta or ruta.startswith(carpeta.rstrip(os.sep) + os.sep)


def scratchpad(datos, sid):
    d = datos.get("scratchpad_dir")
    if isinstance(d, str) and os.path.isdir(d):
        return d
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", sid or ""):
        return None
    for patron in ("/private/tmp/claude-*/*/%s/scratchpad" % sid, "/tmp/claude-*/*/%s/scratchpad" % sid):
        for d in sorted(glob.glob(patron)):
            if os.path.isdir(d):
                return d
    return None


def worktrees_de(repo):
    lista = git(repo, "worktree", "list", "--porcelain") or ""
    return [x[len("worktree "):] for x in lista.splitlines() if x.startswith("worktree ")]


def creado_en(wt):
    """Hora de creación de un worktree enlazado: el fichero `.git` que escribe `worktree add`."""
    try:
        return os.path.getmtime(os.path.join(wt, ".git"))
    except OSError:
        return None


def checkouts(datos, sid, ses):
    """Rutas físicas de los checkouts a mirar, sin repetir; el de cwd primero."""
    res = []

    def poner(p):
        if p and p not in res:
            res.append(p)

    propio = checkout_de(datos.get("cwd") or "")
    proyecto = checkout_de(os.environ.get("CLAUDE_PROJECT_DIR") or "")
    poner(propio)
    poner(proyecto)
    for v in ses.get("vistos") or []:
        poner(checkout_de(v))

    repos = []
    base = os.environ.get("SP_BASE") or os.path.expanduser("~/conductor/repos/manager-opt")
    for r in (propio, proyecto, base if os.path.isdir(base) else None):
        if r and os.path.realpath(r) not in repos:
            repos.append(os.path.realpath(r))
    candidatos = []
    for r in repos:
        candidatos += worktrees_de(r)

    scratch = scratchpad(datos, sid)
    if scratch:
        reales = (scratch, os.path.realpath(scratch))
        try:
            candidatos += [e.path for e in os.scandir(scratch) if e.is_dir(follow_symlinks=False)]
        except OSError:
            pass
        for c in sorted(set(candidatos)):
            p = os.path.realpath(c)
            if any(dentro(x, s) for x in (c, p) for s in reales) and es_checkout(p) and checkout_de(p) == p:
                poner(p)

    # Worktrees de agentes (EnterWorktree, isolation: worktree) creados en esta sesión.
    desde = float(ses.get("inicio") or 0) - 0.5
    for c in sorted(set(candidatos)):
        p = os.path.realpath(c)
        if "/.claude/worktrees/" in p + "/" and p not in res and es_checkout(p):
            t = creado_en(p)
            if t is not None and t >= desde and checkout_de(p) == p:
                poner(p)
    return res


def dir_comun(wt):
    c = git(wt, "rev-parse", "--git-common-dir")
    if not c:
        return None
    return os.path.realpath(c if os.path.isabs(c) else os.path.join(wt, c))


def huella(wt):
    """(huellas {backend, infra, frontend}, versión) o None si no se puede calcular.

    Con el sp-huella del propio checkout si lo tiene (el que usa su sp-test); si falta o falla
    (roto a propósito, rama a medias), con el nuestro. SP_HUELLA (tests) manda en exclusiva."""
    if os.environ.get("SP_HUELLA"):
        scripts = [os.environ["SP_HUELLA"]]
    else:
        scripts = [os.path.join(wt, ".claude", "bin", "sp-huella"), os.path.join(BIN, "sp-huella")]
    for script in scripts:
        if not os.path.isfile(script):
            continue
        try:
            r = subprocess.run([script, "-C", wt, "--json"], capture_output=True, text=True, timeout=20,
                               env=entorno_git())
            h = json.loads(r.stdout) if r.returncode == 0 else None
            if isinstance(h, dict) and all(s in h for s in SUBARBOLES):
                return {s: h[s] for s in SUBARBOLES}, int(h.get("huella_v") or 1)
        except (OSError, subprocess.SubprocessError, ValueError, TypeError):
            pass
    return None


def arboles(wt, commit):
    lista = git(wt, "ls-tree", commit, "--", *SUBARBOLES) if commit else None
    if lista is None:
        return None
    h = {s: None for s in SUBARBOLES}
    for linea in lista.splitlines():
        meta, _, nombre = linea.partition("\t")
        partes = meta.split()
        if nombre in h and len(partes) == 3 and partes[1] == "tree":
            h[nombre] = partes[2]
    return h


def referencia(wt, inicio):
    """Sin línea base: HEAD a la hora en que empezó la sesión; si el checkout aún no existía,
    el commit con el que se creó; sin reflog, el merge-base con origin/main."""
    entradas = []
    for linea in (git(wt, "reflog", "show", "--date=unix", "--format=%H%x09%gd%x09%gs", "HEAD") or "").splitlines():
        partes = linea.split("\t", 2)
        m = re.search(r"@\{(\d+)\}", partes[1]) if len(partes) >= 2 else None
        if m:
            entradas.append((int(m.group(1)), partes[0], partes[2] if len(partes) > 2 else ""))
    commit = None
    # El reflog va del más nuevo al más viejo y en segundos: lo apuntado en el mismo segundo en
    # que empezó la sesión cuenta como de la sesión (crear, editar y commitear en ese segundo).
    antes = [e for e in entradas if e[0] < int(inicio)]
    if antes:
        commit = antes[0][1]
    elif entradas:
        viejas = list(reversed(entradas))
        creacion = [e for e in viejas if not e[2] or e[2].startswith(("checkout:", "reset:", "clone:", "branch:"))]
        commit = (creacion or viejas)[0][1]
    else:
        for ref in ("origin/main", "origin/HEAD", "main", "master"):
            commit = git(wt, "merge-base", "HEAD", ref)
            if commit:
                break
    return arboles(wt, commit)


# --- estado ----------------------------------------------------------------------------------

def leer_json(ruta):
    try:
        with open(ruta, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def escribir_json(ruta, datos):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=os.path.dirname(ruta))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False)
    os.replace(tmp, ruta)


def ahora_iso():
    return datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def fichero_base(comun, wt):
    return os.path.join(comun, "sp-verde", "bases", "%s.json" % hashlib.sha1(wt.encode()).hexdigest()[:16])


def leer_base(comun, wt, version):
    b = leer_json(fichero_base(comun, wt))
    if (isinstance(b, dict) and isinstance(b.get("huellas"), dict) and b.get("worktree") == wt
            and int(b.get("huella_v") or 1) == version):
        return {s: b["huellas"].get(s) for s in SUBARBOLES}
    return None


def guardar_base(comun, wt, h, version, origen):
    escribir_json(fichero_base(comun, wt), {"worktree": wt, "huellas": h, "huella_v": version,
                                            "fecha": ahora_iso(), "origen": origen})


def dir_estado():
    d = os.environ.get("SP_VERDE_ESTADO")
    if d:
        return d
    xdg = os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    return os.path.join(xdg, "sp-verde")


def fichero_sesion(sid):
    return os.path.join(dir_estado(), "sesiones", re.sub(r"[^A-Za-z0-9_.-]", "_", sid)[:120] + ".json")


def hora_de_inicio(datos):
    """Sin estado previo: cuándo se creó el transcript (la sesión reanudada conserva el suyo)."""
    t = datos.get("transcript_path")
    try:
        st = os.stat(t) if isinstance(t, str) and t else None
    except OSError:
        st = None
    if st is not None:
        return float(getattr(st, "st_birthtime", 0) or min(st.st_mtime, st.st_ctime))
    return time.time()


def cargar_sesion(sid, datos):
    s = leer_json(fichero_sesion(sid))
    if not isinstance(s, dict) or not isinstance(s.get("inicio"), (int, float)):
        s = {"sid": sid, "inicio": hora_de_inicio(datos), "vistos": [], "bloqueos": 0}
    if not isinstance(s.get("vistos"), list):
        s["vistos"] = []
    return s


def guardar_sesion(sid, ses):
    escribir_json(fichero_sesion(sid), ses)


def limpiar_estado_viejo(comun):
    limite = time.time() - DIAS_SESION * 86400
    for f in glob.glob(os.path.join(dir_estado(), "sesiones", "*.json")):
        try:
            if os.path.getmtime(f) < limite:
                os.unlink(f)
        except OSError:
            pass
    if comun:
        for f in glob.glob(os.path.join(comun, "sp-verde", "bases", "*.json")):
            b = leer_json(f)
            try:
                if isinstance(b, dict) and b.get("worktree") and not os.path.isdir(b["worktree"]):
                    os.unlink(f)
            except OSError:
                pass


# --- constancias de sp-test ----------------------------------------------------------------

def constancia(comun, wt, nombre):
    """La constancia más reciente de ESTE worktree con ese nombre (verde-back.json…)."""
    mejor, t = None, -1.0
    for ruta in glob.glob(os.path.join(comun, "sp-logs", "*", nombre)):
        c = leer_json(ruta)
        if not isinstance(c, dict) or os.path.realpath(str(c.get("worktree") or "")) != wt:
            continue
        try:
            m = os.path.getmtime(ruta)
        except OSError:
            continue
        if m > t:
            mejor, t = c, m
    return mejor


def fallos_de(c):
    n = 0
    for k in ("failed", "errors"):
        try:
            n += int(c.get(k) or 0)
        except (TypeError, ValueError):
            n += 1
    return n


def evaluar(comun, wt, suite, h, version):
    """None si hay una ejecución completa, que vale y en verde sobre la huella h; si no, el motivo."""
    def misma_version(c):
        return int(c.get("huella_v") or 1) == version

    def coincide(c):
        hc = c.get("huellas")
        return misma_version(c) and isinstance(hc, dict) and all(hc.get(s) == h.get(s) for s in CUBRE[suite])

    completa = constancia(comun, wt, "verde-%s.json" % suite)
    parcial = constancia(comun, wt, "verde-%s-parcial.json" % suite)
    if completa and coincide(completa):
        log = " (log: %s)" % completa["log"] if completa.get("log") else ""
        if completa.get("vale") is not True:
            vale = str(completa.get("vale_linea") or "sin línea VALE").replace("VALE: NO — ", "")
            return "la ejecución completa sobre este estado NO VALE: %s%s" % (vale, log)
        if completa.get("rc") != 0 or fallos_de(completa):
            res = str(completa.get("resultado") or "").replace("RESULTADO: ", "")
            return "la ejecución completa sobre este estado tiene fallos: %s%s" % (res or "rc %s" % completa.get("rc"), log)
        return None
    if parcial and coincide(parcial):
        return ("sobre este estado solo hay una ejecución PARCIAL (%s): sirve para iterar, no abre la puerta"
                % (parcial.get("parcial_por") or "con filtros"))
    if completa and not misma_version(completa):
        return ("la última ejecución completa se midió con otra versión de sp-huella (v%s; ahora v%s): "
                "no sirve, hay que repetirla" % (completa.get("huella_v") or 1, version))
    if completa:
        return ("la última ejecución completa (%s) es de otro estado del código: cambió después"
                % (completa.get("fecha") or "sin fecha"))
    return "no hay ninguna ejecución completa registrada para este checkout"


def sp_test_para(wt):
    """El sp-test del propio checkout si deja constancia (trae sp-huella); si no (rama vieja), el nuestro."""
    propio = os.path.join(wt, ".claude", "bin")
    if os.path.isfile(os.path.join(propio, "sp-huella")) and os.path.isfile(os.path.join(propio, "sp-test")):
        return os.path.join(propio, "sp-test")
    return os.path.join(BIN, "sp-test")


def comandos(wt, suites):
    sp = shlex.quote(sp_test_para(wt))
    q = shlex.quote(wt)
    if "back" in suites and ("front" in suites or "tsc" in suites):
        return ["%s -C %s todo" % (sp, q)]
    return ["%s -C %s %s" % (sp, q, s) for s in ORDEN if s in suites]


# --- último mensaje y trabajo en segundo plano -------------------------------------------------

def ultimo_mensaje(datos):
    m = datos.get("last_assistant_message")
    if isinstance(m, str):
        return m
    ruta = datos.get("transcript_path")
    if not ruta or not os.path.isfile(ruta):
        return ""
    try:
        with open(ruta, "rb") as f:
            f.seek(max(0, os.path.getsize(ruta) - 512 * 1024))
            lineas = f.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return ""
    for linea in reversed(lineas):
        try:
            e = json.loads(linea)
        except ValueError:
            continue
        if not isinstance(e, dict) or e.get("type") != "assistant":
            continue
        cont = (e.get("message") or {}).get("content")
        if isinstance(cont, str) and cont.strip():
            return cont
        if isinstance(cont, list):
            texto = "".join(b.get("text", "") for b in cont if isinstance(b, dict) and b.get("type") == "text")
            if texto.strip():
                return texto
    return ""


def lanza_sp_test(comando):
    """¿Algún programa de la línea (sin comentarios) es …/.claude/bin/sp-test?"""
    try:
        lex = shlex.shlex(comando.replace("\n", " ;\n"), posix=True, punctuation_chars=True)
        lex.whitespace_split = True
        tokens = list(lex)
    except ValueError:
        return False
    seg = []
    for t in tokens + [";"]:
        if t not in OPERADORES:
            seg.append(t)
            continue
        i = 0
        while i < len(seg) and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", seg[i])
                                or os.path.basename(seg[i]) in ENVOLTORIOS or (i and seg[i].startswith("-"))):
            if seg[i] == "-c" and i + 1 < len(seg):  # bash -c '…': mirar dentro
                if lanza_sp_test(seg[i + 1]):
                    return True
                i = len(seg)
                break
            i += 1
        if i < len(seg) and SP_TEST_PROG.search(seg[i]):
            return True
        seg = []
    return False


def esperando(datos):
    """¿El turno acaba para esperar trabajo en segundo plano que lo volverá a despertar?

    Un subagente o un workflow en marcha (pueden estar cambiando código ahora mismo) o un
    `…/.claude/bin/sp-test` en segundo plano. Un servidor (uvicorn, vite) en segundo plano NO
    cuenta: vive toda la sesión y apagaría la puerta."""
    for t in datos.get("background_tasks") or []:
        if not isinstance(t, dict) or str(t.get("status") or "").lower() in (
                "completed", "failed", "killed", "stopped", "cancelled", "done"):
            continue
        if t.get("type") in ("subagent", "workflow"):
            return True
        if t.get("type") in (None, "shell", "bash") and lanza_sp_test(str(t.get("command") or "")):
            return True
    return False


# --- los dos modos -------------------------------------------------------------------------

def inicio(datos, sid):
    """SessionStart: apunta la sesión y, si el checkout de cwd no tiene línea base, la crea
    con el estado actual (el perdón único al instalar). Si ya la tiene, no la toca nunca."""
    ses = cargar_sesion(sid, datos)
    wt = checkout_de(datos.get("cwd") or "")
    comun = None
    if wt:
        if wt not in ses["vistos"]:
            ses["vistos"].append(wt)
        comun = dir_comun(wt)
        r = huella(wt) if comun else None
        if r is not None and leer_base(comun, wt, r[1]) is None:
            guardar_base(comun, wt, r[0], r[1], "SessionStart:%s" % (datos.get("source") or "?"))
    guardar_sesion(sid, ses)
    limpiar_estado_viejo(comun)


def parada(datos, sid):
    if datos.get("hook_event_name") not in (None, "Stop") or datos.get("agent_id"):
        return None
    ses = cargar_sesion(sid, datos)
    propio = checkout_de(datos.get("cwd") or "")
    if propio and propio not in ses["vistos"]:
        ses["vistos"].append(propio)
    revisados, problemas = [], []
    for wt in checkouts(datos, sid, ses):
        comun = dir_comun(wt)
        r = huella(wt) if comun else None
        if r is None:
            continue  # no se puede juzgar: un guardián roto no bloquea
        h, version = r
        guardada = leer_base(comun, wt, version)
        base = guardada or referencia(wt, float(ses["inicio"])) or h
        revisados.append((comun, wt, h, version, guardada))
        cambiados = [s for s in SUBARBOLES if h.get(s) != base.get(s)]
        suites = [s for s in ORDEN if any(s in EXIGE[x] for x in cambiados)]
        malos = []
        for s in suites:
            m = evaluar(comun, wt, s, h, version)
            if m:
                malos.append((s, m))
        if malos:
            problemas.append((wt, cambiados, malos))

    if not problemas:
        for comun, wt, h, version, guardada in revisados:
            if guardada != h:
                guardar_base(comun, wt, h, version, "Stop")
        ses["bloqueos"] = 0
        guardar_sesion(sid, ses)
        return None

    if HONESTA.search(ultimo_mensaje(datos) or "") or esperando(datos):
        ses["bloqueos"] = 0
        guardar_sesion(sid, ses)
        return None  # salida honesta, o espera a trabajo en segundo plano: deja terminar sin aprobar nada

    try:
        previos = int(ses.get("bloqueos") or 0)
    except (TypeError, ValueError):
        previos = 0
    n = (0 if datos.get("stop_hook_active") is False else previos) + 1
    corto = "; ".join("%s: %s" % (wt, ", ".join("%s — %s" % m for m in malos)) for wt, _, malos in problemas)
    if n >= TOPE:
        ses["bloqueos"] = 0
        guardar_sesion(sid, ses)
        return {"systemMessage": "verde-de-verdad: te dejo terminar SIN verde tras %d intentos — %s" % (TOPE, corto)}
    ses["bloqueos"] = n
    guardar_sesion(sid, ses)

    partes = [
        "verde-de-verdad: todavía no puedes terminar. Desde lo último que se aprobó cambió código de "
        "ShiftPlanner y falta una ejecución COMPLETA de sp-test que VALGA y esté en verde sobre EXACTAMENTE "
        "el código de ahora."
    ]
    for wt, cambiados, malos in problemas:
        partes.append("")
        partes.append("%s (cambió %s):" % (wt, ", ".join(cambiados)))
        for s, m in malos:
            partes.append("  - %s: %s." % (s, m))
        for c in comandos(wt, [s for s, _ in malos]):
            partes.append("  Corre: `%s`" % c)
    partes += [
        "",
        "Una ejecución con argumentos (-k, ficheros, --, --sin-prep) sirve para iterar pero no cuenta. Si sale en "
        "rojo, arregla el código: no toques los tests para que pasen (ni skip, ni xfail, ni aflojar un assert). "
        "Si un test contradice lo que se pide, para y responde `BLOQUEADO: <test> contradice <requisito>`; si "
        "necesitas que Max decida algo, empieza tu respuesta con `PREGUNTA:`.",
        "(Bloqueo %d de %d: al %d.º intento se te deja terminar y se avisa a Max.)" % (n, TOPE - 1, TOPE),
    ]
    return {"decision": "block", "reason": "\n".join(partes)}


def main():
    datos = json.load(sys.stdin)
    if not isinstance(datos, dict):
        return
    sid = str(datos.get("session_id") or "")
    if not sid:
        return
    if "--inicio" in sys.argv:
        inicio(datos, sid)
        return
    salida = parada(datos, sid)
    if salida:
        json.dump(salida, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001 — un guardián roto deja pasar
        pass
    sys.exit(0)
