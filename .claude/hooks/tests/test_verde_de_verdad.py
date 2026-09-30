#!/usr/bin/env python3
"""Tests del hook verde-de-verdad (Stop + SessionStart) y de sp-huella.

Herméticos: cada test monta un checkout falso de ShiftPlanner (backend/app/main.py +
frontend/src, lo mismo que mira `es_checkout` de sp-test) con su propio git y un
origin/main, escribe constancias como las que deja sp-test y le pasa al hook la entrada
JSON de Claude Code. Las líneas base y las constancias viven en el .git del repo
temporal; el estado de sesión, en un directorio temporal (SP_VERDE_ESTADO). Se lanzan con:

    python3 .claude/hooks/tests/test_verde_de_verdad.py
"""

import atexit
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HOOKS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(HOOKS, "verde-de-verdad.py")
BIN = os.path.join(os.path.dirname(HOOKS), "bin")
HUELLA = os.path.join(BIN, "sp-huella")
SP_TEST = os.path.join(BIN, "sp-test")
SUBARBOLES = ("backend", "infra", "frontend")
ESTADO = tempfile.mkdtemp(prefix="verde-estado-")
atexit.register(shutil.rmtree, ESTADO, True)
ENTORNO = {"SP_BASE": "/no/existe", "SP_VERDE_ESTADO": ESTADO, "CLAUDE_PROJECT_DIR": ""}


def escribir(ruta, texto):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(texto)


def git(d, *args, check=True):
    return subprocess.run(["git", "-C", d, "-c", "user.email=t@t", "-c", "user.name=t", *args],
                          check=check, capture_output=True, text=True).stdout.strip()


def montar_checkout(r, gitignore="__pycache__/\nnode_modules\n"):
    escribir(os.path.join(r, "backend", "app", "main.py"), "app = None\n")
    escribir(os.path.join(r, "backend", "app", "logica.py"), "VALOR = 1\n")
    escribir(os.path.join(r, "backend", "tests", "test_a.py"), "def test_a():\n    assert True\n")
    escribir(os.path.join(r, "frontend", "src", "lib", "schedule", "a.ts"), "export const a = 1;\n")
    escribir(os.path.join(r, "infra", "initdb", "01-app-role.sql"), "-- rol\n")
    escribir(os.path.join(r, ".claude", "settings.json"), "{}\n")
    escribir(os.path.join(r, "README.md"), "# ShiftPlanner\n")
    escribir(os.path.join(r, ".gitignore"), gitignore)
    git(r, "init", "-q", "-b", "main")
    git(r, "add", "-A")
    git(r, "commit", "-q", "-m", "base")
    git(r, "update-ref", "refs/remotes/origin/main", "HEAD")
    return os.path.realpath(r)


def huellas(wt):
    """{"huella_v": 2, "backend": …}: la salida JSON de sp-huella."""
    return json.loads(subprocess.run([HUELLA, "-C", wt, "--json"], check=True, capture_output=True,
                                     text=True).stdout)


def solo_arboles(h):
    return {s: h[s] for s in SUBARBOLES}


def dir_comun(wt):
    c = git(wt, "rev-parse", "--git-common-dir")
    return os.path.realpath(c if os.path.isabs(c) else os.path.join(wt, c))


def constancia(wt, suite, parcial=False, vale=True, rc=0, failed=0, h=None, version=None):
    d = os.path.join(dir_comun(wt), "sp-logs", "%s-abc123" % re.sub(r"\W", "_", os.path.basename(wt)))
    h = h if h is not None else huellas(wt)
    datos = {
        "suite": suite, "completa": not parcial, "parcial_por": "con argumentos: -k algo" if parcial else None,
        "args": ["-k", "algo"] if parcial else [], "vale": vale,
        "vale_linea": "VALE: sí" if vale else "VALE: NO — 93 skipped fuera de test_intake_schema_contract",
        "resultado": "RESULTADO: 10 passed · 0 skipped · %d failed · 0 errors · 0 xfailed" % failed,
        "rc": rc, "passed": 10, "failed": failed, "errors": 0, "skipped": 0,
        "huellas": solo_arboles(h), "huella_v": version if version is not None else h.get("huella_v", 1),
        "sp_huella": HUELLA, "fecha": "2026-09-29T10:00:00+02:00", "worktree": wt,
        "log": os.path.join(d, "%s-x.log" % suite),
    }
    escribir(os.path.join(d, "verde-%s%s.json" % (suite, "-parcial" if parcial else "")), json.dumps(datos))


def correr(entrada, *args, env=None):
    r = subprocess.run([sys.executable, HOOK, *args],
                       input=entrada if isinstance(entrada, str) else json.dumps(entrada),
                       capture_output=True, text=True, env={**os.environ, **ENTORNO, **(env or {})}, timeout=60)
    return r.returncode, r.stdout


def nuevo_sid():
    return "prueba-" + next(tempfile._get_candidate_names()) + next(tempfile._get_candidate_names())


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = montar_checkout(os.path.join(self.tmp.name, "repo"))
        self.sid = nuevo_sid()

    def tearDown(self):
        self.tmp.cleanup()

    def inicio(self, cwd=None, source="startup", sid=None, env=None, **extra):
        rc, out = correr({"session_id": sid or self.sid, "hook_event_name": "SessionStart", "source": source,
                          "cwd": cwd or self.repo, **extra}, "--inicio", env=env)
        self.assertEqual((rc, out), (0, ""), "SessionStart no puede escribir nada: su stdout va al contexto")

    def parar(self, mensaje="Hecho: cambios aplicados.", activo=False, cwd=None, env=None, sid=None, **extra):
        entrada = {"session_id": sid or self.sid, "hook_event_name": "Stop", "cwd": cwd or self.repo,
                   "stop_hook_active": activo, "last_assistant_message": mensaje, **extra}
        if mensaje is None:
            del entrada["last_assistant_message"]
        rc, out = correr(entrada, env=env)
        self.assertEqual(rc, 0)
        return json.loads(out) if out.strip() else None

    def bloquea(self, **kw):
        d = self.parar(**kw)
        self.assertIsNotNone(d, "debía bloquear")
        self.assertEqual(d.get("decision"), "block", d)
        return d["reason"]

    def pasa(self, **kw):
        d = self.parar(**kw)
        self.assertIsNone(d, d and (d.get("reason") or d.get("systemMessage")))

    def tocar(self, rel, texto="# cambio\n", wt=None):
        with open(os.path.join(wt or self.repo, rel), "a", encoding="utf-8") as f:
            f.write(texto)

    def worktree(self, padre, nombre, desde="origin/main"):
        ruta = os.path.join(padre, nombre)
        os.makedirs(padre, exist_ok=True)
        git(self.repo, "worktree", "add", "-q", "-b", "rama-" + re.sub(r"\W", "-", nombre), ruta, desde)
        return os.path.realpath(ruta)

    def base_guardada(self, wt=None):
        d = os.path.join(dir_comun(wt or self.repo), "sp-verde", "bases")
        for f in os.listdir(d) if os.path.isdir(d) else []:
            with open(os.path.join(d, f)) as fh:
                b = json.load(fh)
            if b.get("worktree") == (wt or self.repo):
                return b
        return None


class Decision(Base):
    def test_sin_cambios_pasa(self):
        self.inicio()
        self.pasa()
        self.pasa(activo=True)

    def test_solo_conversacion_con_worktree_sucio_y_linea_base_igual_pasa(self):
        self.tocar("backend/app/main.py")
        escribir(os.path.join(self.repo, "frontend", "src", "nuevo.ts"), "export const b = 2;\n")
        self.inicio()
        self.pasa()

    def test_cambio_en_backend_sin_sp_test_bloquea_con_el_comando_exacto(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        m = self.bloquea()
        self.assertIn("`%s -C %s back`" % (SP_TEST, self.repo), m)
        self.assertIn("no toques los tests para que pasen", m)
        self.assertIn("BLOQUEADO: <test> contradice <requisito>", m)
        self.assertIn("cambió backend", m)
        self.assertIn("no hay ninguna ejecución completa", m)
        self.assertNotIn("tsc", m)
        self.assertIn("Bloqueo 1 de 4", m)

    def test_fichero_nuevo_sin_commitear_cuenta(self):
        self.inicio()
        escribir(os.path.join(self.repo, "backend", "app", "nuevo.py"), "x = 1\n")
        self.assertIn(" back`", self.bloquea())

    def test_ficheros_ignorados_o_artefactos_de_las_suites_no_cuentan(self):
        self.inicio()
        escribir(os.path.join(self.repo, "backend", "app", "__pycache__", "main.cpython-311.pyc"), "basura")
        escribir(os.path.join(self.repo, "frontend", "node_modules", "x", "index.js"), "basura")
        escribir(os.path.join(self.repo, "backend", ".hypothesis", "examples", "ab", "cd"), "basura")
        escribir(os.path.join(self.repo, "frontend", "coverage", "index.html"), "basura")
        self.pasa()

    def test_infra_exige_back(self):
        self.inicio()
        self.tocar("infra/initdb/01-app-role.sql", "-- grant\n")
        m = self.bloquea()
        self.assertIn("cambió infra", m)
        self.assertIn("`%s -C %s back`" % (SP_TEST, self.repo), m)

    def test_sp_test_parcial_bloquea(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        constancia(self.repo, "back", parcial=True)
        m = self.bloquea()
        self.assertIn("PARCIAL", m)
        self.assertIn("-k algo", m)

    def test_parcial_despues_de_una_completa_en_verde_no_cierra_la_puerta(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        constancia(self.repo, "back")
        constancia(self.repo, "back", parcial=True)
        self.pasa()

    def test_vale_no_bloquea(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        constancia(self.repo, "back", vale=False, rc=2)
        m = self.bloquea()
        self.assertIn("NO VALE", m)
        self.assertIn("93 skipped", m)

    def test_con_fallos_bloquea(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        constancia(self.repo, "back", rc=1, failed=2)
        m = self.bloquea()
        self.assertIn("tiene fallos", m)
        self.assertIn("2 failed", m)

    def test_huella_distinta_de_la_del_json_bloquea(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        constancia(self.repo, "back")  # en verde… sobre este estado
        self.tocar("backend/app/main.py", "# y otro cambio después de la suite\n")
        self.assertIn("es de otro estado del código", self.bloquea())

    def test_frontend_cambiado_con_front_pero_sin_tsc_bloquea(self):
        self.inicio()
        self.tocar("frontend/src/lib/schedule/a.ts", "export const c = 3;\n")
        constancia(self.repo, "front")
        m = self.bloquea()
        self.assertIn("- tsc:", m)
        self.assertNotIn("- front:", m)
        self.assertIn("`%s -C %s tsc`" % (SP_TEST, self.repo), m)
        self.assertNotIn(" todo", m)

    def test_backend_y_frontend_sin_nada_piden_todo(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        self.tocar("frontend/src/lib/schedule/a.ts", "export const c = 3;\n")
        self.assertIn("`%s -C %s todo`" % (SP_TEST, self.repo), self.bloquea())

    def test_todo_verde_pasa_y_actualiza_la_linea_base(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        self.tocar("frontend/src/lib/schedule/a.ts", "export const c = 3;\n")
        for s in ("back", "front", "tsc"):
            constancia(self.repo, s)
        self.pasa()
        b = self.base_guardada()
        self.assertEqual((b["huellas"], b["huella_v"], b["origen"]), (solo_arboles(huellas(self.repo)), 2, "Stop"))
        # La línea base ya es este estado: sin constancias, el turno siguiente pasa.
        shutil.rmtree(os.path.join(dir_comun(self.repo), "sp-logs"))
        self.pasa()

    def test_revertir_a_la_linea_base_pasa(self):
        self.inicio()
        ruta = os.path.join(self.repo, "backend", "app", "main.py")
        with open(ruta) as f:
            original = f.read()
        self.tocar("backend/app/main.py")
        self.bloquea()
        escribir(ruta, original)
        self.pasa()

    def test_bloqueado_y_pregunta_pasan_sin_actualizar_la_linea_base(self):
        self.inicio()
        antes = self.base_guardada()
        self.tocar("backend/app/main.py")
        self.pasa(mensaje="BLOQUEADO: tests/test_a.py contradice el requisito de cerrar a las 03:30")
        self.pasa(mensaje="  **PREGUNTA:** ¿cierro también los domingos?")
        self.assertEqual(self.base_guardada(), antes)
        self.assertIn(" back`", self.bloquea(mensaje="Listo."), "la puerta sigue viva en el turno siguiente")

    def test_salida_honesta_en_cualquier_linea_y_con_markdown(self):
        # CLAUDE.md obliga a abrir con «Skill: …», «Agente: …» o «CORRECCIÓN: …».
        self.inicio()
        self.tocar("backend/app/main.py")
        for msg in ("Skill: entorno-de-pruebas\n\nBLOQUEADO: tests/test_a.py contradice X",
                    "Agente: ejecutor-tests\n- **PREGUNTA**: ¿sigo?",
                    "CORRECCIÓN: me equivoqué.\n> bloqueado: el test contradice el requisito",
                    "\n  BLOQUEADO: con espacios delante",
                    "Skill: x\n1. `PREGUNTA:` ¿esto o aquello?"):
            with self.subTest(msg=msg):
                self.pasa(mensaje=msg)
        for msg in ("Te pregunto: BLOQUEADO: a mitad de frase no cuenta",
                    "Skill: x\nHe dicho que PREGUNTA: no es el principio",
                    "BLOQUEADOS: otra palabra"):
            with self.subTest(msg=msg):
                self.bloquea(mensaje=msg)

    def test_sin_last_assistant_message_lee_el_transcript(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        tr = os.path.join(self.tmp.name, "t.jsonl")
        lineas = [
            {"type": "user", "message": {"role": "user", "content": "hazlo"}},
            {"type": "assistant", "message": {"role": "assistant", "content": [
                {"type": "text", "text": "Skill: x\nPREGUNTA: ¿qué horario quieres?"}]}},
            {"type": "assistant", "message": {"role": "assistant", "content": [
                {"type": "tool_use", "id": "x", "name": "Bash", "input": {}}]}},
        ]
        escribir(tr, "\n".join(json.dumps(x) for x in lineas) + "\n")
        self.pasa(mensaje=None, transcript_path=tr)
        self.bloquea(mensaje=None)

    def test_esperar_trabajo_en_segundo_plano_pasa_sin_aprobar(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        agente = {"id": "a1", "type": "subagent", "status": "running", "description": "implementador",
                  "agent_type": "general-purpose"}

        def shell(cmd):
            return {"id": "b1", "type": "shell", "status": "running", "description": "x", "command": cmd}
        servidor = shell("cd backend && .venv/bin/uvicorn app.main:app --port 8011")
        for tareas in ([agente], [servidor, shell("/x/.claude/bin/sp-test -C /x todo")],
                       [shell("cd /x && /x/.claude/bin/sp-test -C /x todo 2>&1 | tail -20")],
                       [shell("SP_PY=/y bash -c '/x/.claude/bin/sp-test -C /x back'")],
                       [shell("nohup .claude/bin/sp-test back > /tmp/l 2>&1")]):
            with self.subTest(tareas=tareas):
                self.pasa(background_tasks=tareas)
        for tareas in ([servidor], [dict(agente, status="completed")], [],
                       [shell("sleep 999999 # sp-test")], [shell("echo sp-test")],
                       [shell("cat /x/.claude/bin/sp-test")], [shell("sleep 9 # /x/.claude/bin/sp-test todo")]):
            with self.subTest(tareas=tareas):
                self.bloquea(background_tasks=tareas)

    def test_cinco_bloqueos_seguidos_pasa_con_system_message(self):
        self.inicio()
        antes = self.base_guardada()
        self.tocar("backend/app/main.py")
        for i in range(1, 5):
            self.assertIn("Bloqueo %d de 4" % i, self.bloquea(activo=(i > 1)))
        d = self.parar(activo=True)
        self.assertNotIn("decision", d)
        self.assertTrue(d["systemMessage"].startswith(
            "verde-de-verdad: te dejo terminar SIN verde tras 5 intentos — "), d)
        self.assertIn("back", d["systemMessage"])
        self.assertEqual(self.base_guardada(), antes, "el tope no aprueba nada")
        # Turno nuevo (stop_hook_active false): la puerta sigue viva y el contador empieza de cero.
        self.assertIn("Bloqueo 1 de 4", self.bloquea(activo=False))

    def test_stop_hook_active_false_reinicia_el_contador(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        self.bloquea()
        self.assertIn("Bloqueo 2 de 4", self.bloquea(activo=True))
        self.assertIn("Bloqueo 1 de 4", self.bloquea(activo=False))

    def test_solo_claude_y_docs_cambiados_pasa(self):
        self.inicio()
        self.tocar(".claude/settings.json", "\n")
        escribir(os.path.join(self.repo, ".claude", "hooks", "nuevo.py"), "print(1)\n")
        self.tocar("README.md", "más docs\n")
        escribir(os.path.join(self.repo, "NOTAS.md"), "notas\n")
        self.pasa()

    def test_compactar_no_perdona_lo_que_quedo_sin_probar(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        self.inicio(source="compact")
        self.bloquea()

    def test_clear_con_session_id_nuevo_no_perdona(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        self.bloquea()
        otra = nuevo_sid()
        self.inicio(source="clear", sid=otra)
        self.assertIn(" back`", self.bloquea(sid=otra))

    def test_la_linea_base_sobrevive_a_la_sesion(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        constancia(self.repo, "back")
        self.pasa()
        otra = nuevo_sid()
        self.inicio(sid=otra)
        self.pasa(sid=otra)
        self.tocar("backend/app/main.py", "# otro\n")
        self.inicio(sid=nuevo_sid())  # una sesión nueva no la toca
        self.bloquea(sid=otra)

    def test_subagentes_no(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        self.pasa(agent_id="a1", agent_type="Explore")
        self.pasa(hook_event_name="SubagentStop")

    def test_sin_session_start_lo_no_commiteado_cuenta(self):
        # Sin línea base (SessionStart no llegó a correr), la referencia es HEAD al empezar la sesión.
        self.tocar("backend/app/main.py")
        self.assertIn(" back`", self.bloquea())
        constancia(self.repo, "back")
        self.pasa()
        self.pasa()

    def test_commit_de_la_sesion_cuenta_como_cambio(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        git(self.repo, "commit", "-qam", "sin probar")
        self.assertIn(" back`", self.bloquea())

    def test_sp_huella_propio_roto_no_apaga_la_puerta(self):
        self.inicio()
        falso = os.path.join(self.repo, ".claude", "bin", "sp-huella")
        escribir(falso, "#!/bin/sh\nexit 0\n")
        os.chmod(falso, 0o755)
        self.tocar("backend/app/main.py")
        self.assertIn(" back`", self.bloquea())

    def test_version_de_huella_distinta_no_vale(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        constancia(self.repo, "back", version=1)
        m = self.bloquea()
        self.assertIn("otra versión de sp-huella (v1; ahora v2)", m)

    def test_se_usa_el_sp_huella_del_propio_checkout(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        real = huellas(self.repo)
        falso = os.path.join(self.repo, ".claude", "bin", "sp-huella")
        escribir(falso, "#!/bin/sh\nexec %s \"$@\" | sed 's/\"huella_v\": 2/\"huella_v\": 9/'\n" % shlex.quote(HUELLA))
        os.chmod(falso, 0o755)
        escribir(os.path.join(self.repo, ".claude", "bin", "sp-test"), "#!/bin/sh\n")
        constancia(self.repo, "back", h=real, version=2)
        m = self.bloquea()
        self.assertIn("(v2; ahora v9)", m)
        self.assertIn("`%s/.claude/bin/sp-test -C %s back`" % (self.repo, self.repo), m)
        constancia(self.repo, "back", h=real, version=9)
        self.pasa()


class Checkouts(Base):
    """Qué checkouts mira: cwd, CLAUDE_PROJECT_DIR, vistos, scratchpad y .claude/worktrees nuevos."""

    def setUp(self):
        super().setUp()
        uid = os.getuid()
        raiz = "/private/tmp/claude-%d" % uid if os.path.isdir("/private/tmp") else "/tmp/claude-%d" % uid
        self.proyecto = os.path.join(raiz, "proyecto-de-prueba-verde")
        self.scratch = os.path.join(self.proyecto, self.sid, "scratchpad")
        os.makedirs(self.scratch)

    def tearDown(self):
        shutil.rmtree(os.path.join(self.proyecto, self.sid), ignore_errors=True)
        try:
            os.rmdir(self.proyecto)
        except OSError:
            pass
        super().tearDown()

    def test_cambio_en_worktree_del_scratchpad_bloquea(self):
        self.inicio()  # cwd = BASE; el worktree aún no existe
        wt = self.worktree(self.scratch, "wt")
        self.pasa()  # recién creado: igual que el commit con el que se creó
        self.tocar("backend/app/main.py", wt=wt)
        m = self.bloquea()
        self.assertIn(wt + " (cambió backend)", m)
        self.assertIn("`%s -C %s back`" % (SP_TEST, wt), m)
        self.assertNotIn(self.repo + " (", m, "BASE no cambió")
        constancia(wt, "back")
        self.pasa()

    def test_commit_en_el_worktree_sin_probar_tambien_bloquea(self):
        self.inicio()
        wt = self.worktree(self.scratch, "wt")
        self.tocar("backend/app/main.py", wt=wt)
        git(wt, "commit", "-q", "-am", "cambio sin probar")
        self.assertIn(" back`", self.bloquea())

    def test_creado_editado_y_commiteado_en_el_mismo_segundo_que_el_inicio(self):
        while time.time() % 1 > 0.3:
            time.sleep(0.01)
        self.inicio()
        wt = self.worktree(self.scratch, "wt")
        self.tocar("backend/app/main.py", wt=wt)
        git(wt, "commit", "-qam", "sin probar")
        self.assertIn(" back`", self.bloquea())

    def test_revisar_una_pr_sin_tocarla_no_exige_la_suite(self):
        self.inicio()
        git(self.repo, "branch", "pr-198", "origin/main")
        tmp = os.path.join(self.tmp.name, "tmp-pr")
        git(self.repo, "worktree", "add", "-q", tmp, "pr-198")
        self.tocar("backend/app/main.py", "# cambio de la PR\n", wt=tmp)
        git(tmp, "commit", "-qam", "la PR")
        git(self.repo, "worktree", "remove", tmp)
        rev = os.path.join(self.scratch, "rev")
        git(self.repo, "worktree", "add", "-q", rev, "pr-198")  # como gh pr checkout en un worktree
        self.pasa()
        self.tocar("backend/app/main.py", "# retoque del revisor\n", wt=rev)
        self.assertIn(" back`", self.bloquea())

    def test_scratchpad_dir_de_la_entrada_y_sin_sp_base(self):
        self.inicio()
        wt = self.worktree(self.scratch, "wt")
        self.tocar("frontend/src/lib/schedule/a.ts", "export const d = 4;\n", wt=wt)
        m = self.bloquea(cwd="/", scratchpad_dir=self.scratch)
        self.assertIn(wt + " (cambió frontend)", m)
        self.assertIn("- front:", m)
        self.assertIn("- tsc:", m)

    def test_compactar_no_fija_la_linea_base_del_worktree(self):
        self.inicio()
        wt = self.worktree(self.scratch, "wt")
        self.tocar("backend/app/main.py", wt=wt)
        self.inicio(source="compact")
        self.bloquea()

    def test_sp_test_propio_del_worktree_si_deja_constancia(self):
        self.inicio()
        wt = self.worktree(self.scratch, "wt")
        os.makedirs(os.path.join(wt, ".claude", "bin"))
        shutil.copy2(HUELLA, os.path.join(wt, ".claude", "bin", "sp-huella"))
        escribir(os.path.join(wt, ".claude", "bin", "sp-test"), "#!/bin/sh\n")
        self.tocar("backend/app/main.py", wt=wt)
        self.assertIn("`%s/.claude/bin/sp-test -C %s back`" % (wt, wt), self.bloquea())

    def test_ruta_con_espacios_y_no_ascii_va_entrecomillada(self):
        self.inicio()
        wt = self.worktree(self.scratch, "wt Ñandú 2")
        self.tocar("backend/app/main.py", wt=wt)
        m = self.bloquea()
        cmd = "%s -C %s back" % (shlex.quote(SP_TEST), shlex.quote(wt))
        self.assertIn("`%s`" % cmd, m)
        self.assertEqual(shlex.split(cmd), [SP_TEST, "-C", wt, "back"])

    def test_cd_a_un_workspace_existente_a_mitad_de_sesion(self):
        ws = self.worktree(os.path.join(self.tmp.name, "conductor", "workspaces"), "bilbao")
        self.inicio()  # en BASE
        self.pasa(cwd=ws)  # entrar sin tocar nada: nada que probar
        self.tocar("backend/app/main.py", wt=ws)
        m = self.bloquea(cwd=ws)
        self.assertIn(ws + " (cambió backend)", m)
        # Vuelve a BASE y termina ahí: el workspace sigue en «vistos».
        self.assertIn(ws + " (cambió backend)", self.bloquea(activo=True))

    def test_worktree_de_agente_creado_en_la_sesion(self):
        viejo = self.worktree(os.path.join(self.repo, ".claude", "worktrees"), "viejo")
        self.tocar("backend/app/main.py", wt=viejo)  # de otra sesión: no es cosa nuestra
        time.sleep(1.1)
        self.inicio()
        ag = self.worktree(os.path.join(self.repo, ".claude", "worktrees"), "agente")
        self.pasa()
        self.tocar("backend/app/main.py", wt=ag)
        m = self.bloquea()  # cwd = BASE: se encuentra igual
        self.assertIn(ag + " (cambió backend)", m)
        self.assertNotIn(viejo, m)
        self.assertIn(ag + " (cambió backend)", self.bloquea(cwd=ag, activo=True))

    def test_claude_project_dir_y_cwd_fuera(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        otro = os.path.join(self.tmp.name, "otro")
        os.makedirs(otro)
        git(otro, "init", "-q")
        m = self.bloquea(cwd=otro)  # BASE está en «vistos»
        self.assertIn(self.repo + " (cambió backend)", m)
        m = self.bloquea(cwd=otro, sid=nuevo_sid(), env={"CLAUDE_PROJECT_DIR": self.repo})
        self.assertIn(self.repo + " (cambió backend)", m)

    def test_el_contador_no_depende_del_cwd(self):
        self.inicio()
        wt = self.worktree(self.scratch, "wt")
        self.tocar("backend/app/main.py", wt=wt)
        self.assertIn("Bloqueo 1 de 4", self.bloquea())
        self.assertIn("Bloqueo 2 de 4", self.bloquea(cwd=wt, activo=True))
        self.assertIn("Bloqueo 3 de 4", self.bloquea(cwd="/", activo=True))


class ErroresInternos(Base):
    def test_entrada_rota_deja_pasar(self):
        self.assertEqual(correr("no es json"), (0, ""))
        self.assertEqual(correr("no es json", "--inicio"), (0, ""))
        self.assertEqual(correr("[1, 2]"), (0, ""))
        self.assertEqual(correr({"hook_event_name": "Stop", "cwd": self.repo}), (0, ""), "sin session_id")

    def test_repo_inexistente_o_fuera_de_shiftplanner_deja_pasar(self):
        self.assertIsNone(self.parar(cwd="/no/existe/nada"))
        with tempfile.TemporaryDirectory() as otro:
            git(otro, "init", "-q")
            escribir(os.path.join(otro, "backend", "x.py"), "x = 1\n")
            self.assertIsNone(self.parar(cwd=otro))

    def test_huella_rota_deja_pasar(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        self.pasa(env={"SP_HUELLA": "/usr/bin/false"})

    def test_estado_y_constancias_rotos_no_revientan(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        bases = os.path.join(dir_comun(self.repo), "sp-verde", "bases")
        for f in os.listdir(bases):
            escribir(os.path.join(bases, f), "{roto")
        escribir(os.path.join(dir_comun(self.repo), "sp-logs", "x", "verde-back.json"), "{roto")
        escribir(os.path.join(ESTADO, "sesiones", self.sid + ".json"), "{roto")
        # Sin línea base ni sesión legibles: referencia = HEAD; la constancia rota no cuenta.
        self.assertIn("no hay ninguna ejecución completa", self.bloquea())
        constancia(self.repo, "back")
        self.pasa()


class SpHuella(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = montar_checkout(os.path.join(self.tmp.name, "repo"))

    def tearDown(self):
        self.tmp.cleanup()

    def tocar(self, rel):
        with open(os.path.join(self.repo, rel), "a") as f:
            f.write("# x\n")

    def test_en_limpio_coincide_con_head(self):
        h = huellas(self.repo)
        self.assertEqual(h["huella_v"], 2)
        for s in SUBARBOLES:
            self.assertEqual(h[s], git(self.repo, "rev-parse", "HEAD:" + s))

    def test_no_toca_el_indice_real_ni_el_stash(self):
        indice = os.path.join(self.repo, ".git", "index")
        with open(indice, "rb") as f:
            antes = f.read()
        mtime = os.stat(indice).st_mtime_ns
        self.tocar("backend/app/main.py")
        escribir(os.path.join(self.repo, "backend", "app", "nuevo.py"), "x = 1\n")
        huellas(self.repo)
        with open(indice, "rb") as f:
            self.assertEqual(f.read(), antes)
        self.assertEqual(os.stat(indice).st_mtime_ns, mtime)
        self.assertFalse(os.path.exists(os.path.join(self.repo, ".git", "refs", "stash")))

    def test_cambia_con_lo_que_hay_en_disco_y_vuelve_al_revertir(self):
        h0 = huellas(self.repo)
        self.tocar("backend/app/main.py")
        h1 = huellas(self.repo)
        self.assertNotEqual(h0["backend"], h1["backend"])
        self.assertEqual((h0["infra"], h0["frontend"]), (h1["infra"], h1["frontend"]))
        escribir(os.path.join(self.repo, "backend", "app", "main.py"), "app = None\n")
        self.assertEqual(huellas(self.repo), h0)
        escribir(os.path.join(self.repo, "frontend", "src", "nuevo.ts"), "1\n")
        self.assertNotEqual(huellas(self.repo)["frontend"], h0["frontend"])
        escribir(os.path.join(self.repo, "frontend", "node_modules", "x.js"), "1\n")
        os.unlink(os.path.join(self.repo, "frontend", "src", "nuevo.ts"))
        self.assertEqual(huellas(self.repo), h0, "lo ignorado no cuenta")

    def test_mismo_tamano_en_el_mismo_segundo_que_un_git_status(self):
        # Racy git: con el índice copiado sin su mtime, git se fía del stat y no ve la edición.
        logica = os.path.join(self.repo, "backend", "app", "logica.py")
        h0 = huellas(self.repo)
        time.sleep(1.05)
        while time.time() % 1 > 0.15:
            time.sleep(0.01)
        os.utime(logica)
        subprocess.run(["git", "-C", self.repo, "status", "--porcelain"], capture_output=True)
        escribir(logica, "VALOR = 3\n")  # mismo tamaño que «VALOR = 1\n»
        time.sleep(1.2)
        self.assertNotEqual(huellas(self.repo)["backend"], h0["backend"])

    def test_rebase_con_conflicto_fuera_de_los_subarboles(self):
        git(self.repo, "checkout", "-q", "-b", "rama")
        escribir(os.path.join(self.repo, "README.md"), "# rama\n")
        self.tocar("backend/app/main.py")
        git(self.repo, "commit", "-qam", "rama")
        git(self.repo, "checkout", "-q", "main")
        escribir(os.path.join(self.repo, "README.md"), "# main\n")
        git(self.repo, "commit", "-qam", "main")
        git(self.repo, "checkout", "-q", "rama")
        git(self.repo, "rebase", "main", check=False)
        self.assertIn("UU README.md", git(self.repo, "status", "--porcelain"))
        r = subprocess.run([HUELLA, "-C", self.repo, "--json"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        h = json.loads(r.stdout)
        self.assertNotEqual(h["backend"], git(self.repo, "rev-parse", "main:backend"), "ve el backend del disco")
        self.assertIn("UU README.md", git(self.repo, "status", "--porcelain"), "no resuelve nada en el índice real")

    def test_conflicto_dentro_del_backend(self):
        git(self.repo, "checkout", "-q", "-b", "rama")
        escribir(os.path.join(self.repo, "backend", "app", "logica.py"), "VALOR = 2\n")
        git(self.repo, "commit", "-qam", "rama")
        git(self.repo, "checkout", "-q", "main")
        escribir(os.path.join(self.repo, "backend", "app", "logica.py"), "VALOR = 3\n")
        git(self.repo, "commit", "-qam", "main")
        git(self.repo, "merge", "rama", check=False)
        r = subprocess.run([HUELLA, "-C", self.repo, "--json"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_artefactos_de_las_suites_no_cuentan_aunque_no_esten_en_gitignore(self):
        with tempfile.TemporaryDirectory() as d:
            repo = montar_checkout(os.path.join(d, "r"), gitignore="")
            h0 = huellas(repo)
            for rel in ("backend/.hypothesis/examples/ab/cd", "backend/app/__pycache__/x.pyc",
                        "backend/.pytest_cache/v/cache/lastfailed", "frontend/node_modules/x/i.js",
                        "frontend/coverage/index.html", "frontend/dist/index.html"):
                escribir(os.path.join(repo, rel), "artefacto\n")
            self.assertEqual(huellas(repo), h0)
            escribir(os.path.join(repo, "backend", "app", "distribucion.py"), "x = 1\n")
            self.assertNotEqual(huellas(repo)["backend"], h0["backend"], "solo las carpetas, no nombres parecidos")

    def test_subarbol_ausente(self):
        shutil.rmtree(os.path.join(self.repo, "infra"))
        self.assertIsNone(huellas(self.repo)["infra"])
        r = subprocess.run([HUELLA, "-C", self.repo], capture_output=True, text=True, check=True)
        self.assertIn("infra -\n", r.stdout)
        self.assertIn("huella_v 2\n", r.stdout)

    def test_fuera_de_un_repo_falla_con_2(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(subprocess.run([HUELLA, "-C", d], capture_output=True).returncode, 2)


class ConstanciaDeSpTest(Base):
    """El escritor de constancias va embebido en sp-test: se extrae y se cruza con el hook."""

    def escritor(self):
        with open(SP_TEST, encoding="utf-8") as f:
            texto = f.read()
        m = re.search(r"cat >\"\$TMPD/constancia\.py\" <<'PY'\n(.*?)\nPY\n", texto, re.S)
        self.assertIsNotNone(m, "sp-test ya no embebe constancia.py")
        ruta = os.path.join(self.tmp.name, "constancia.py")
        escribir(ruta, m.group(1))
        return ruta

    def escribir_constancia(self, suite, bloque, datos, parcial="", rc=0, args=()):
        d = os.path.join(dir_comun(self.repo), "sp-logs", "repo-abc123")
        os.makedirs(d, exist_ok=True)
        fb = os.path.join(self.tmp.name, suite + ".bloque")
        escribir(fb, bloque)
        fd = os.path.join(self.tmp.name, suite + ".json")
        if datos is not None:
            escribir(fd, json.dumps(datos))
        h = subprocess.run([HUELLA, "-C", self.repo, "--json"], capture_output=True, text=True).stdout
        subprocess.run([sys.executable, self.escritor(), suite, str(rc), fb, fd, self.repo, parcial, h,
                        "/x.log", d, HUELLA, *args], check=True)
        return d

    def test_back_completo_en_verde_abre_la_puerta(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        cuentas = {"passed": 5, "failed": 0, "errors": 0, "skipped": 0, "xfailed": 0, "xpassed": 0, "deselected": 0}
        d = self.escribir_constancia("back", "RESULTADO: 5 passed\nVALE: sí\n", {"cuentas": cuentas})
        with open(os.path.join(d, "verde-back.json")) as f:
            c = json.load(f)
        self.assertEqual((c["completa"], c["vale"], c["passed"], c["failed"], c["rc"]), (True, True, 5, 0, 0))
        self.assertEqual((c["huella_v"], c["sp_huella"]), (2, HUELLA))
        self.assertNotIn("huella_v", c["huellas"])
        self.pasa()

    def test_back_con_argumentos_o_deseleccionados_es_parcial(self):
        self.inicio()
        self.tocar("backend/app/main.py")
        cuentas = {"passed": 5, "failed": 0, "errors": 0, "skipped": 0, "deselected": 0}
        d = self.escribir_constancia("back", "VALE: sí\n", {"cuentas": cuentas}, parcial="con argumentos: -k x",
                                     args=("-k", "x"))
        self.assertTrue(os.path.isfile(os.path.join(d, "verde-back-parcial.json")))
        self.assertFalse(os.path.isfile(os.path.join(d, "verde-back.json")))
        self.assertIn("PARCIAL", self.bloquea())
        cuentas["deselected"] = 7
        self.escribir_constancia("back", "VALE: sí\n", {"cuentas": cuentas})
        self.assertFalse(os.path.isfile(os.path.join(d, "verde-back.json")))

    def test_tsc_con_errores_y_vale_no(self):
        self.inicio()
        self.tocar("frontend/src/lib/schedule/a.ts", "export const e = 5;\n")
        d = self.escribir_constancia("tsc", "RESULTADO: 3 errores en 1 ficheros\nVALE: sí\n", None, rc=1)
        with open(os.path.join(d, "verde-tsc.json")) as f:
            self.assertEqual(json.load(f)["failed"], 3)
        vitest = {"numPassedTests": 4, "numFailedTests": 0, "numPendingTests": 0, "numFailedTestSuites": 0}
        self.escribir_constancia("front", "RESULTADO: …\nVALE: NO — a frontend/node_modules le faltan x\n", vitest, rc=2)
        m = self.bloquea()
        self.assertIn("- tsc: la ejecución completa sobre este estado tiene fallos: 3 errores", m)
        self.assertIn("- front: la ejecución completa sobre este estado NO VALE: a frontend/node_modules", m)


if __name__ == "__main__":
    unittest.main(verbosity=1)
