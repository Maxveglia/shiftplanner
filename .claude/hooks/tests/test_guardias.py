#!/usr/bin/env python3
"""Tests de los hooks guardia-lectura, guardia-bash y estado-sesion.

Herméticos: montan un checkout falso de ShiftPlanner en un directorio temporal
(backend/app/main.py + frontend/src/lib/schedule, que es lo que los guardianes
miran para saber que están en ShiftPlanner) con un git propio, así que no
dependen de cuánto mida hoy DashboardPage.tsx. Los corre el eval
`contexto-ligero/cases/01-*` y se lanzan a mano con:

    python3 .claude/hooks/tests/test_guardias.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HOOKS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LECTURA = os.path.join(HOOKS, "guardia-lectura.py")
BASH = os.path.join(HOOKS, "guardia-bash.py")
ESTADO = os.path.join(HOOKS, "estado-sesion.sh")


def escribir(ruta, texto):
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(texto)


def hook(script, entrada, env=None):
    r = subprocess.run(
        [sys.executable, script] if script.endswith(".py") else [script],
        input=entrada if isinstance(entrada, str) else json.dumps(entrada),
        capture_output=True,
        text=True,
        env={**os.environ, **(env or {})},
        timeout=20,
    )
    return r.returncode, r.stdout


def motivo(salida):
    if not salida.strip():
        return None
    datos = json.loads(salida)["hookSpecificOutput"]
    assert datos["hookEventName"] == "PreToolUse"
    assert datos["permissionDecision"] == "deny"
    return datos["permissionDecisionReason"]


class Checkout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        r = cls.raiz = os.path.realpath(cls.tmp.name)
        os.makedirs(os.path.join(r, "backend", "app"))
        os.makedirs(os.path.join(r, "frontend", "src", "lib", "schedule"))
        escribir(os.path.join(r, "backend", "app", "main.py"), "app = None\n")
        cls.grande = os.path.join(r, "frontend", "src", "Grande.tsx")
        with open(cls.grande, "w") as f:
            f.writelines(f"export const linea{i} = {i}; // relleno para que pese\n" for i in range(1500))
        cls.pequeno = os.path.join(r, "frontend", "src", "Pequeno.tsx")
        escribir(cls.pequeno, "export const a = 1;\n")
        sh = lambda *a: subprocess.run(["git", "-C", r, *a], check=True, capture_output=True)
        sh("init", "-q")
        sh("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "vacío")
        sh("add", "-A")
        sh("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "grande")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()


class GuardiaLectura(Checkout):
    def leer(self, **entrada):
        return hook(LECTURA, {"tool_input": entrada})

    def test_grande_sin_limit_se_deniega_con_el_indice(self):
        rc, out = self.leer(file_path=self.grande)
        self.assertEqual(rc, 0)
        m = motivo(out)
        self.assertIn("1.500 líneas", m)
        self.assertIn("sp-outline", m)
        self.assertIn("offset/limit", m)

    def test_con_limit_pasa(self):
        self.assertIsNone(motivo(self.leer(file_path=self.grande, limit=2000)[1]))

    def test_offset_cerca_del_final_pasa(self):
        self.assertIsNone(motivo(self.leer(file_path=self.grande, offset=1000)[1]))

    def test_pequeno_pasa(self):
        self.assertIsNone(motivo(self.leer(file_path=self.pequeno)[1]))

    def test_fuera_de_shiftplanner_pasa(self):
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            f.write("x\n" * 5000)
        try:
            self.assertIsNone(motivo(self.leer(file_path=f.name)[1]))
        finally:
            os.unlink(f.name)

    def test_entrada_rota_deja_pasar(self):
        self.assertEqual(hook(LECTURA, "no es json"), (0, ""))

    def usuario(self, proyecto):
        r = subprocess.run(
            [sys.executable, LECTURA, "--usuario"],
            input=json.dumps({"tool_input": {"file_path": self.grande}}),
            capture_output=True, text=True, env={**os.environ, "CLAUDE_PROJECT_DIR": proyecto},
        )
        return r.stdout

    def test_copia_de_usuario_se_calla_si_el_proyecto_lo_registra(self):
        with tempfile.TemporaryDirectory() as p:
            os.makedirs(os.path.join(p, ".claude"))
            os.makedirs(os.path.join(p, "backend", "app"))
            escribir(os.path.join(p, "backend", "app", "main.py"), "")
            escribir(os.path.join(p, ".claude", "settings.json"), '{"x": "guardia-lectura.py"}')
            self.assertEqual(self.usuario(p), "")

    def test_copia_de_usuario_no_se_calla_en_una_sesion_de_home(self):
        # En `~`, CLAUDE_PROJECT_DIR es el HOME y su .claude/settings.json es el de usuario,
        # que es justo donde estaría registrada la copia de usuario.
        with tempfile.TemporaryDirectory() as home:
            os.makedirs(os.path.join(home, ".claude"))
            escribir(os.path.join(home, ".claude", "settings.json"), '{"x": "guardia-lectura.py --usuario"}')
            self.assertIsNotNone(motivo(self.usuario(home)))


class GuardiaBash(Checkout):
    def bash(self, comando, env=None):
        return motivo(hook(BASH, {"tool_input": {"command": comando}, "cwd": "/"}, env)[1])

    def test_lectores_de_fichero_entero(self):
        g = self.grande
        for c in (f"cat {g}", f"cat -n {g}", f"cd {self.raiz}/frontend && cat src/Grande.tsx",
                  f"head -n 900 {g}", f"tail -n +100 {g}", f"sed -n '1,700p' {g}", f"sed -n '200,$p' {g}"):
            with self.subTest(c=c):
                m = self.bash(c)
                self.assertIsNotNone(m, c)
                self.assertIn("sp-outline", m)
        self.assertIsNotNone(self.bash(f"cat {g} 2>/dev/null"), "2> no redirige la salida estándar")

    def test_varios_comandos_por_linea_y_comentarios(self):
        g, p = self.grande, self.pequeno
        self.assertIsNone(self.bash(f"cat {p}\ngrep -n linea7 {g}"), "el salto de línea separa comandos")
        self.assertIsNone(self.bash(f"cat {p} # luego mirar {g}"), "un comentario no es un argumento")
        self.assertIsNotNone(self.bash(f"echo hola\ncat {g}"))
        self.assertIsNone(self.bash(f"curl -s http://localhost:8000/a#b && head -20 {g}"))

    def test_lecturas_acotadas_o_filtradas_pasan(self):
        g = self.grande
        for c in (f"sed -n '100,300p' {g}", f"head -50 {g}", f"cat {g} | grep linea7",
                  f"cat {self.pequeno}", f"SP_ENTERO=1 cat {g}", f"grep -n linea {g}",
                  f"cat {g} > /tmp/copia.tsx", f"cat {g} >> /tmp/copia.tsx 2>&1",
                  "cat /etc/hosts", "python3 - <<'EOF'\nprint(open('x').read())\nEOF", "echo 'sin cerrar"):
            with self.subTest(c=c):
                self.assertIsNone(self.bash(c), c)

    def test_git_show_de_un_fichero_grande(self):
        m = self.bash(f"git -C {self.raiz} show HEAD:frontend/src/Grande.tsx")
        self.assertIn("sed -n", m)
        self.assertIsNone(self.bash(f"git -C {self.raiz} show HEAD:frontend/src/Pequeno.tsx"))

    def test_diff_grande_trae_el_stat(self):
        m = self.bash(f"git -C {self.raiz} diff HEAD~1 HEAD")
        self.assertIn("1502 líneas cambiadas", m)
        self.assertIn("Grande.tsx", m)  # el --stat va en el motivo
        m = self.bash(f"git -C {self.raiz} show HEAD")
        self.assertIn("Grande.tsx", m)

    def test_el_git_del_hook_no_escribe_nada(self):
        destino = os.path.join(self.raiz, "no-debe-existir.diff")
        self.bash(f"git -C {self.raiz} diff HEAD~1 HEAD --stat=80 --output={destino} -- frontend")
        self.bash(f"git -C {self.raiz} diff --output={destino} HEAD~1 HEAD")
        self.assertFalse(os.path.exists(destino))

    def test_git_show_de_un_merge_pasa(self):
        # En main todo commit es un merge de PR: `git show` enseña el diff combinado (corto),
        # pero --numstat lo mediría contra el primer padre.
        r = self.raiz
        merge = subprocess.run(
            ["git", "-C", r, "-c", "user.email=t@t", "-c", "user.name=t", "commit-tree", "HEAD^{tree}",
             "-p", "HEAD~1", "-p", "HEAD", "-m", "merge"], capture_output=True, text=True, check=True).stdout.strip()
        self.assertIsNone(self.bash(f"git -C {r} show {merge}"))

    def test_diff_contra_el_arbol_de_trabajo_no_se_mide_ni_toca_el_indice(self):
        r = self.raiz
        indice = os.path.join(r, ".git", "index")
        antes = os.stat(indice).st_mtime_ns
        os.utime(self.grande)  # stat distinto sin cambio de contenido: un diff refrescaría el índice
        for c in (f"git -C {r} diff", f"git -C {r} diff HEAD~1", f"git -C {r} diff --cached HEAD~1"):
            with self.subTest(c=c):
                self.assertIsNone(self.bash(c), c)
        self.assertEqual(os.stat(indice).st_mtime_ns, antes)

    def test_resumenes_de_git_pasan(self):
        r = self.raiz
        for c in (f"git -C {r} diff --compact-summary HEAD~1 HEAD", f"git -C {r} show --raw HEAD",
                  f"git -C {r} diff --stat-count=5 HEAD~1 HEAD", f"git -C {r} diff --stat-width=80 HEAD~1 HEAD"):
            with self.subTest(c=c):
                self.assertIsNone(self.bash(c), c)

    def test_diff_de_un_fichero_grande_dice_como_trocearlo(self):
        m = self.bash(f"git -C {self.raiz} diff HEAD~1 HEAD -- frontend/src/Grande.tsx")
        self.assertIn("^@@", m)

    def test_diff_resumido_o_pequeno_pasa(self):
        r = self.raiz
        for c in (f"git -C {r} diff --stat HEAD~1 HEAD", f"git -C {r} diff HEAD~1 HEAD --name-only",
                  f"git -C {r} diff HEAD~1 HEAD -- frontend/src/Pequeno.tsx", f"git -C {r} diff HEAD~1 HEAD | head -40",
                  f"git -C {r} log --oneline -3", f"git -C {r} diff HEAD~1 HEAD > /tmp/x.diff",
                  f"git -C {r} diff HEAD~1 HEAD --output=/tmp/x.diff"):
            with self.subTest(c=c):
                self.assertIsNone(self.bash(c), c)

    def test_railway_logs_en_streaming(self):
        self.assertIn("sp-logs", self.bash("cd ~/conductor/repos/manager-opt && railway logs --service shiftplanner"))
        self.assertIsNone(self.bash("railway logs --service shiftplanner --lines 200"))
        self.assertIsNone(self.bash("railway logs --http --since 1h --lines 500"))
        for c in ("railway logs -n200", "railway logs --help", "railway logs -h"):
            self.assertIsNone(self.bash(c), c)

    def test_pytest_sin_base(self):
        sin = self.bash(f"cd {self.raiz}/backend && .venv/bin/python -m pytest -q", {"APP_DATABASE_URL": ""})
        self.assertIn("sp-test", sin)
        self.assertIsNone(self.bash(
            f"cd {self.raiz}/backend && ADMIN_DATABASE_URL=a APP_DATABASE_URL=b .venv/bin/python -m pytest -q"))
        self.assertIsNone(self.bash("cd /tmp && pytest -q", {"APP_DATABASE_URL": ""}))
        self.assertIn("sp-test", self.bash(f"cd {self.raiz}/backend && pytest tests/x.py", {"APP_DATABASE_URL": ""}))
        for c in ("pip show pytest", "pip list | grep -i pytest", "grep -rn pytest pyproject.toml",
                  "ls .venv/bin/pytest", "git commit -m pytest"):
            with self.subTest(c=c):
                self.assertIsNone(self.bash(f"cd {self.raiz}/backend && {c}", {"APP_DATABASE_URL": ""}), c)


class EstadoSesion(unittest.TestCase):
    def test_nota_de_traspaso_tras_compactar(self):
        sid = "test-" + next(tempfile._get_candidate_names())
        uid = os.getuid()
        raiz = f"/private/tmp/claude-{uid}" if os.path.isdir("/private/tmp") else f"/tmp/claude-{uid}"
        scratch = os.path.join(raiz, "proyecto-de-prueba", sid, "scratchpad")
        os.makedirs(scratch)
        try:
            escribir(os.path.join(scratch, "traspaso.md"), "# Objetivo de prueba\nSiguiente paso: X\n")
            rc, out = hook(ESTADO, {"session_id": sid, "source": "compact"}, {"SP_BASE": "/no/existe"})
            self.assertEqual(rc, 0)
            self.assertIn("Objetivo de prueba", out)
            self.assertIn("Siguiente paso: X", out)
            rc, out = hook(ESTADO, {"session_id": "sesion-que-no-existe", "source": "compact"})
            self.assertEqual((rc, out), (0, ""))
        finally:
            shutil.rmtree(os.path.join(raiz, "proyecto-de-prueba", sid))
            try:
                os.rmdir(os.path.join(raiz, "proyecto-de-prueba"))
            except OSError:
                pass


if __name__ == "__main__":
    unittest.main(verbosity=1)
