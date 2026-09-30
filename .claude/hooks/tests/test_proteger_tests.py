#!/usr/bin/env python3
"""Tests del hook proteger-tests.

Herméticos: montan un checkout falso de ShiftPlanner (backend/app/main.py +
frontend/src/lib/schedule, lo que el hook mira) con un git propio. La base es un
commit apuntado por `refs/remotes/origin/main`; la rama añade un test propio encima.
Se lanzan a mano con:

    python3 .claude/hooks/tests/test_proteger_tests.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HOOKS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOK = os.path.join(HOOKS, "proteger-tests.py")

EN_MAIN = [
    "backend/tests/test_base.py",
    "backend/tests/conftest.py",
    "backend/tests/known_gap.py",
    "backend/tests/nb.ipynb",
    "frontend/src/lib/a.test.ts",
    "frontend/src/lib/b.spec.tsx",
    "frontend/src/test/knownGap.ts",
    "frontend/src/components/__tests__/c.ts",
    "frontend/vitest.config.ts",
    ".claude/hooks/tests/test_x.py",
]
CODIGO = ["backend/app/servicio.py", "frontend/src/lib/schedule/spec.ts", ".claude/evals/foo/cases/01.md"]


def escribir(ruta, texto="x = 1\n"):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(texto)


def sh(r, *a):
    return subprocess.run(["git", "-C", r, "-c", "user.email=t@t", "-c", "user.name=t", *a],
                          check=True, capture_output=True, text=True).stdout


def hook(entrada):
    r = subprocess.run([sys.executable, HOOK], input=entrada if isinstance(entrada, str) else json.dumps(entrada),
                       capture_output=True, text=True, timeout=20)
    return r.returncode, r.stdout


def decision(salida):
    """None si deja pasar; el motivo si pregunta."""
    if not salida.strip():
        return None
    datos = json.loads(salida)["hookSpecificOutput"]
    assert datos["hookEventName"] == "PreToolUse"
    assert datos["permissionDecision"] == "ask", datos
    assert "BLOQUEADO" in datos["additionalContext"]
    return datos["permissionDecisionReason"]


def montar(r, con_origin=True):
    os.makedirs(os.path.join(r, "frontend", "src"))
    escribir(os.path.join(r, "backend", "app", "main.py"), "app = None\n")
    for rel in EN_MAIN + CODIGO:
        escribir(os.path.join(r, rel))
    sh(r, "init", "-q", "-b", "main")
    sh(r, "add", "-A")
    sh(r, "commit", "-q", "-m", "base")
    if con_origin:
        sh(r, "update-ref", "refs/remotes/origin/main", "HEAD")
    sh(r, "checkout", "-q", "-b", "rama")
    escribir(os.path.join(r, "backend", "tests", "test_rama.py"))
    sh(r, "add", "-A")
    sh(r, "commit", "-q", "-m", "test de la rama")


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.raiz = os.path.join(os.path.realpath(cls.tmp.name), "repo")
        os.makedirs(cls.raiz)
        montar(cls.raiz)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def r(self, rel):
        return os.path.join(self.raiz, rel)

    def editar(self, rel, herramienta="Edit", cwd="/"):
        clave = "notebook_path" if herramienta == "NotebookEdit" else "file_path"
        return decision(hook({"tool_name": herramienta, "tool_input": {clave: self.r(rel) if not os.path.isabs(rel) else rel},
                              "cwd": cwd})[1])

    def bash(self, comando, cwd=None):
        return decision(hook({"tool_name": "Bash", "tool_input": {"command": comando}, "cwd": cwd or self.raiz})[1])


class Edicion(Base):
    def test_editar_un_test_de_main_pregunta(self):
        m = self.editar("backend/tests/test_base.py")
        self.assertIn("`backend/tests/test_base.py` es un test que ya existe en main", m)
        self.assertIn("OK de Max", m)
        self.assertIn("BLOQUEADO: <test> contradice <requisito>", m)
        for rel in EN_MAIN:
            for h in ("Edit", "Write", "MultiEdit"):
                with self.subTest(rel=rel, h=h):
                    self.assertIsNotNone(self.editar(rel, h), rel)
        self.assertIsNotNone(self.editar("backend/tests/nb.ipynb", "NotebookEdit"))

    def test_crear_un_test_nuevo_pasa(self):
        for rel in ("backend/tests/test_nuevo.py", "frontend/src/lib/nuevo.test.ts", "backend/app/pytest.ini.md",
                    "frontend/src/lib/carpeta/nueva/__tests__/x.ts"):
            with self.subTest(rel=rel):
                self.assertIsNone(self.editar(rel, "Write"))

    def test_editar_un_test_creado_en_la_rama_pasa(self):
        self.assertIsNone(self.editar("backend/tests/test_rama.py"))

    def test_codigo_y_evals_pasan(self):
        for rel in CODIGO:
            with self.subTest(rel=rel):
                self.assertIsNone(self.editar(rel))

    def test_ruta_relativa_se_resuelve_con_el_cwd(self):
        self.assertIsNotNone(decision(hook({"tool_name": "Edit", "tool_input": {"file_path": "tests/test_base.py"},
                                            "cwd": self.r("backend")})[1]))

    def test_otras_herramientas_no_se_miran(self):
        self.assertIsNone(decision(hook({"tool_name": "Read", "tool_input": {"file_path": self.r("backend/tests/test_base.py")}})[1]))

    def test_worktree_editado_desde_base(self):
        # La sesión está en el checkout principal y edita un worktree del scratchpad: manda el worktree.
        wt = os.path.join(os.path.dirname(self.raiz), "wt")
        sh(self.raiz, "worktree", "add", "-q", "-b", "otra", wt, "origin/main")
        try:
            escribir(os.path.join(wt, "backend", "tests", "test_del_wt.py"))
            sh(wt, "add", "-A")
            sh(wt, "commit", "-q", "-m", "test del worktree")
            ask = lambda rel: decision(hook({"tool_name": "Edit", "tool_input": {"file_path": os.path.join(wt, rel)},
                                             "cwd": self.raiz})[1])
            self.assertIsNotNone(ask("backend/tests/test_base.py"))
            self.assertIsNone(ask("backend/tests/test_del_wt.py"))
            self.assertIsNone(ask("backend/tests/test_rama.py"), "test_rama es de la otra rama: aquí sería nuevo")
        finally:
            sh(self.raiz, "worktree", "remove", "--force", wt)

    def test_fuera_de_shiftplanner_pasa(self):
        with tempfile.TemporaryDirectory() as d:
            escribir(os.path.join(d, "backend", "tests", "test_a.py"))
            sh(d, "init", "-q", "-b", "main")
            sh(d, "add", "-A")
            sh(d, "commit", "-q", "-m", "a")
            sh(d, "update-ref", "refs/remotes/origin/main", "HEAD")
            self.assertIsNone(self.editar(os.path.join(d, "backend", "tests", "test_a.py")))
            self.assertIsNone(self.bash(f"rm -rf {d}/backend/tests", cwd=d))

    def test_sin_origin_main_usa_main_y_sin_ninguna_deja_pasar(self):
        with tempfile.TemporaryDirectory() as d:
            r = os.path.join(os.path.realpath(d), "repo")
            os.makedirs(r)
            montar(r, con_origin=False)
            ruta = os.path.join(r, "backend", "tests", "test_base.py")
            self.assertIsNotNone(decision(hook({"tool_name": "Edit", "tool_input": {"file_path": ruta}})[1]))
            sh(r, "branch", "-q", "-m", "main", "vieja")
            self.assertIsNone(decision(hook({"tool_name": "Edit", "tool_input": {"file_path": ruta}})[1]))

    def test_mayusculas_en_un_disco_que_no_las_distingue(self):
        if not os.path.exists(self.r("BACKEND/TESTS/TEST_BASE.PY")):
            self.skipTest("este disco distingue mayúsculas: son ficheros distintos")
        for rel in ("frontend/src/lib/a.test.TS", "backend/TESTS/Test_Base.py", "Backend/Tests/test_base.py"):
            with self.subTest(rel=rel):
                self.assertIn("`", self.editar(rel))
        self.assertIsNotNone(self.bash("sed -i '' s/a/b/ backend/TESTS/test_base.PY"))
        self.assertIsNone(self.editar("BACKEND/TESTS/test_nuevo.py", "Write"))

    def test_clon_superficial_usa_origin_main(self):
        with tempfile.TemporaryDirectory() as d:
            clon = os.path.join(os.path.realpath(d), "clon")
            subprocess.run(["git", "clone", "-q", "--depth", "1", "--no-single-branch", "file://" + self.raiz, clon],
                           check=True, capture_output=True)
            sh(clon, "checkout", "-q", "rama")
            self.assertIsNone(subprocess.run(["git", "-C", clon, "merge-base", "HEAD", "origin/main"],
                                             capture_output=True).stdout.strip() or None, "el merge-base debería fallar")
            ask = lambda rel: decision(hook({"tool_name": "Edit", "tool_input": {"file_path": os.path.join(clon, rel)}})[1])
            self.assertIsNotNone(ask("backend/tests/test_base.py"))
            self.assertIsNone(ask("backend/tests/test_rama.py"))

    def test_checkout_es_main_py_y_frontend_src(self):
        # La misma definición que sp-test y verde-de-verdad: no hace falta frontend/src/lib/schedule.
        with tempfile.TemporaryDirectory() as d:
            r = os.path.realpath(d)
            escribir(os.path.join(r, "backend", "app", "main.py"))
            escribir(os.path.join(r, "frontend", "src", "a.ts"))
            escribir(os.path.join(r, "backend", "tests", "test_a.py"))
            sh(r, "init", "-q", "-b", "main")
            sh(r, "add", "-A")
            sh(r, "commit", "-q", "-m", "a")
            self.assertIsNotNone(self.editar(os.path.join(r, "backend", "tests", "test_a.py")))

    def test_entrada_rota_deja_pasar(self):
        for entrada in ("no es json", "", "[1, 2]", json.dumps({"tool_name": "Edit"}),
                        json.dumps({"tool_name": "Edit", "tool_input": {"file_path": 3}})):
            with self.subTest(entrada=entrada):
                rc, out = hook(entrada)
                self.assertEqual(rc, 0)
                self.assertNotIn("permissionDecision", out)


class Bash(Base):
    def test_formas_que_cambian_o_borran_un_test_preguntan(self):
        t = "backend/tests/test_base.py"
        T = self.r(t)
        casos = [
            f"sed -i '' 's/a/b/' {t}",
            f"sed -i.bak -e 's/a/b/' {T}",
            f"sed -Ei 's/a/b/' {t}",
            f"perl -pi -e 's/a/b/' {t}",
            f"ruby -i -pe 'x' {t}",
            f"gawk -i inplace '{{print}}' {t}",
            f"echo x > {t}",
            f"echo x >> frontend/src/lib/a.test.ts",
            f"echo x 2>{t}",
            f"cat <<'EOF' > backend/tests/conftest.py\nimport pytest\nEOF",
            f"echo x | tee {t}",
            f"echo x | tee -a /tmp/log {t}",
            f"cp /tmp/x.py {t}",
            "cp /tmp/test_base.py backend/tests/",
            "cp -f /tmp/test_base.py -t backend/tests && true",
            f"mv /tmp/x.py {t}",
            f"mv {t} /tmp/",
            f"git mv {t} backend/tests/test_otro.py",
            f"install -m 644 /tmp/x {t}",
            f"rsync -a /tmp/x.py {t}",
            "rsync -a --delete /tmp/vacio/ backend/tests/",
            f"rm {t}",
            "rm -rf backend/tests",
            "rm -rf frontend/src/components/__tests__",
            f"rm -f backend/tests/test_*.py",
            f"git rm {t}",
            "git rm -r --cached backend/tests",
            f"unlink {t}",
            f"truncate -s 0 {t}",
            f"shred -u {t}",
            f"git checkout HEAD~1 -- {t}",
            f"git checkout HEAD~1 {t}",
            f"git restore --source=HEAD~1 {t}",
            f"git restore -s HEAD~1 --staged --worktree {t}",
            f"python3 -c \"open('{t}','w').write('')\"",
            f"python3 -c \"import os; os.remove('{t}')\"",
            f"python3 - <<'EOF'\nfrom pathlib import Path\nPath('{t}').write_text('x')\nEOF",
            "node -e \"require('fs').writeFileSync('frontend/src/lib/a.test.ts', '')\"",
            f"perl -e 'unlink \"{t}\"'",
            f"cd backend && sed -i '' s/a/b/ tests/test_base.py",
            f"WT={self.raiz}; sed -i '' s/a/b/ $WT/{t}",
            f"export WT={self.raiz} && rm ${{WT}}/{t}",
            f"bash -c \"rm {t}\"",
            f"bash <<'EOF'\nrm {t}\nEOF",
            f"eval rm {t}",
            f"sed -i '' s/a/b/ backend/tests/test_*.py",
            "sed -i '' s/a/b/ frontend/src/test/knownGap.ts",
            "sed -i '' s/a/b/ .claude/hooks/tests/test_x.py",
            "sed -i '' 's/it.fails/it.skip/' frontend/src/test/knownGap.ts",
            f"echo hola; echo x > {t}",
            f"true && \\\n  rm {t}",
            f"gsed -i 's/a/b/' {t}",
            f"dd if=/dev/null of={t}",
            f"ln -sf /tmp/x {t}",
            f"python3 -c \"import shutil; shutil.rmtree('backend/tests')\"",
            f"git apply <<'EOF'\n--- a/{t}\n+++ b/{t}\n@@ -1 +1 @@\n-x = 1\n+x = 2\nEOF",
            f"patch -p1 <<'EOF'\n--- a/{t}\n+++ b/{t}\n@@ -1 +1 @@\n-x = 1\n+x = 2\nEOF",
            f"echo $(rm {t})",
        ]
        for c in casos:
            with self.subTest(c=c):
                self.assertIsNotNone(self.bash(c), c)
        # Con `git -C` y desde fuera del checkout.
        self.assertIsNotNone(self.bash(f"git -C {self.raiz} checkout HEAD -- {t}", cwd="/"))
        self.assertIsNotNone(self.bash(f"sed -i '' s/a/b/ {T}", cwd="/"))

    def test_restaurar_desde_el_indice_pregunta_si_y_solo_si_no_escribe_el_test_de_main(self):
        # `git checkout -- x` / `git restore x` copian el ÍNDICE encima del disco.
        t = "backend/tests/test_base.py"
        restaurar = (f"git checkout -- {t}", f"git restore {t}", "git checkout -- backend/tests", "git checkout .",
                     "git restore .", f"git -C {self.raiz} restore {t}", f"git -C {self.raiz}/backend restore tests/test_base.py")
        for c in restaurar:
            with self.subTest(c=c, indice="el de main"):
                self.assertIsNone(self.bash(c), c)
        with open(self.r(t), encoding="utf-8") as f:
            original = f.read()
        try:
            escribir(self.r(t), original + "assert True\n")  # solo el disco: restaurar devuelve el de main
            for c in restaurar:
                with self.subTest(c=c, indice="el de main", disco="cambiado"):
                    self.assertIsNone(self.bash(c), c)
            sh(self.raiz, "add", t)  # el índice ya no es el de main
            escribir(self.r(t), original)  # y el disco sí (P-R03)
            for c in restaurar:
                with self.subTest(c=c, indice="cambiado"):
                    self.assertIsNotNone(self.bash(c), c)
        finally:
            escribir(self.r(t), original)
            sh(self.raiz, "add", t)
        # Con una revisión delante (o `--staged --worktree`, que copia HEAD), siempre.
        self.assertIsNotNone(self.bash(f"git checkout HEAD~1 -- {t}"))
        self.assertIsNotNone(self.bash(f"git restore --staged --worktree {t}"))

    def test_subshell_y_procesos_aparte_no_se_llevan_el_cd(self):
        t = "backend/tests/test_base.py"
        for c in (f"(cd frontend && ls); rm {t}",
                  f"(cd frontend; (cd src && ls)); rm {t}",
                  f"bash -c 'cd frontend'; rm {t}",
                  f"sh -c \"cd /tmp && ls\" && rm {t}",
                  f"cd frontend | cat; rm {t}",
                  f"echo $(cd /tmp; pwd); rm {t}"):
            with self.subTest(c=c):
                self.assertIsNotNone(self.bash(c), c)
        # El cd dentro del subshell sí vale para lo que va dentro.
        self.assertIsNotNone(self.bash("(cd backend && rm tests/test_base.py)"))
        self.assertIsNone(self.bash(f"(cd /tmp && rm tests/test_base.py)"))

    def test_heredoc_y_comentario_solo_fuera_de_comillas(self):
        t = "backend/tests/test_base.py"
        for c in (f"python3 -c \"print(1 << 2)\"\nrm {t}",
                  f"echo 'a <<EOF'\nrm {t}",
                  f"echo \"#1\"; rm {t}",
                  f"git commit -m 'arregla #12' && rm {t}"):
            with self.subTest(c=c):
                self.assertIsNotNone(self.bash(c), c)
        self.assertIsNone(self.bash(f"echo hola # rm {t}"))

    def test_apagar_tests_sin_tocarlos_pregunta_aunque_sea_nuevo(self):
        for rel in ("backend/tests/sub/conftest.py", "backend/app/conftest.py", "backend/pytest.ini",
                    "backend/setup.cfg", "backend/tox.ini", "backend/tests/pytest.ini", "frontend/vitest.config.mts"):
            with self.subTest(rel=rel):
                m = self.editar(rel, "Write")
                self.assertIn("cambia qué tests corren", m)
        self.assertIsNotNone(self.bash("echo 'addopts = -k nada' > backend/pytest.ini"))
        self.assertIsNotNone(self.bash("cat > backend/tests/sub/conftest.py <<'EOF'\nimport pytest\nEOF"))
        self.assertIsNotNone(self.bash("cp /tmp/conftest.py backend/app/"))
        self.assertIsNone(self.editar("backend/pytest.ini.md", "Write"))

    def test_pyproject_solo_si_toca_pytest(self):
        pyproject = self.r("backend/pyproject.toml")
        escribir(pyproject, '[project]\nname = "x"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n')
        sh(self.raiz, "add", "backend/pyproject.toml")
        sh(self.raiz, "commit", "-q", "-m", "pyproject")
        sh(self.raiz, "update-ref", "refs/remotes/origin/main", "HEAD")
        try:
            edit = lambda viejo, nuevo, h="Edit": decision(hook({"tool_name": h, "tool_input": {
                "file_path": pyproject, "old_string": viejo, "new_string": nuevo}})[1])
            self.assertIn("cambia qué tests corren", edit('testpaths = ["tests"]', 'testpaths = ["tests"]\naddopts = "-k not x"'))
            self.assertIsNotNone(edit('testpaths = ["tests"]', 'testpaths = ["tests/sub"]'))
            self.assertIsNotNone(edit('name = "x"', 'name = "x"\n\n[tool.pytest]\naddopts = "--deselect a"'))
            self.assertIsNone(edit('name = "x"', 'name = "y"'))
            self.assertIsNotNone(decision(hook({"tool_name": "MultiEdit", "tool_input": {"file_path": pyproject, "edits": [
                {"old_string": 'name = "x"', "new_string": 'name = "y"'},
                {"old_string": "[tool.pytest.ini_options]", "new_string": "[tool.pytest.ini_options]\ncollect_ignore = ['tests']"}]}})[1]))
            write = lambda contenido: decision(hook({"tool_name": "Write", "tool_input": {
                "file_path": pyproject, "content": contenido}})[1])
            self.assertIsNone(write('[project]\nname = "otro"\ndependencies = ["a"]\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n'))
            self.assertIsNotNone(write('[project]\nname = "x"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\naddopts = "-q"\n'))
            self.assertIsNotNone(write('[project]\nname = "x"\n'))  # quitar la sección también
            self.assertIsNotNone(self.bash("sed -i '' 's/testpaths = .*/testpaths = []/' backend/pyproject.toml"))
            self.assertIsNone(self.bash("sed -i '' 's/name = .*/name = \"y\"/' backend/pyproject.toml"))
        finally:
            sh(self.raiz, "reset", "-q", "--hard", "HEAD~1")
            sh(self.raiz, "update-ref", "refs/remotes/origin/main", "HEAD~1")

    def test_el_motivo_dice_que_test_y_con_que(self):
        m = self.bash("sed -i '' s/a/b/ backend/tests/test_base.py")
        self.assertIn("`backend/tests/test_base.py`", m)
        self.assertIn("sed -i", m)
        m = self.bash("rm -rf backend/tests")
        self.assertIn("son tests que ya existen en main", m)
        self.assertIn("más", m)  # hay más de tres

    def test_comandos_inofensivos_que_mencionan_tests_pasan(self):
        t = "backend/tests/test_base.py"
        casos = [
            ("pytest tests/test_base.py", self.r("backend")),
            (f"cat {t} | head", None),
            ("git diff -- backend/tests/", None),
            ("grep -r foo backend/tests/", None),
            ("vitest run src/lib/a.test.ts", self.r("frontend")),
            ("npx vitest run frontend/src/lib/a.test.ts", None),
            (f"sed -n '1,20p' {t}", None),
            (f"sed 's/a/b/' {t} > /tmp/copia.py", None),
            (f"cp {t} /tmp/copia.py", None),
            ("ls backend/tests > /tmp/lista.txt", None),
            (f"python3 -c \"print(open('{t}').read())\"", None),
            (f"python3 -c \"t = open('{t}').read(); print(t.replace('a', 'b'))\"", None),
            (f"python3 -c \"import sys; sys.stdout.write(open('{t}').read())\"", None),
            ("git checkout -b otra-rama", None),
            ("git checkout main", None),
            (f"git restore --staged {t}", None),
            (f"git rm -n {t}", None),
            ("git log --oneline -- backend/tests", None),
            ("git add backend/tests && git commit -m 'tests'", None),
            (f"wc -l {t} 2>/dev/null", None),
            (f"echo '{t}' >> /tmp/notas.md", None),
            (f"cat > /tmp/nota.md <<'EOF'\nrm {t}\nEOF", None),
            (f"echo 'rm {t}'", None),
            (f"grep -n foo {t} # luego sed -i en {t}", None),
            (f"touch {t}", None),
            ("rsync -a --delay-updates /tmp/x/ /tmp/y/", None),
        ]
        for c, cwd in casos:
            with self.subTest(c=c):
                self.assertIsNone(self.bash(c, cwd), c)

    def test_tests_nuevos_o_de_la_rama_y_evals_pasan(self):
        for c in ("echo x > backend/tests/test_nuevo.py", "sed -i '' s/a/b/ backend/tests/test_rama.py",
                  "rm backend/tests/test_rama.py", "cp /tmp/x.py backend/tests/test_nuevo.py",
                  "echo x > .claude/evals/foo/cases/01.md", "rm -rf .claude/evals/foo",
                  "sed -i '' s/a/b/ backend/app/servicio.py", "rm -rf frontend/node_modules",
                  "sed -i '' s/a/b/ frontend/src/lib/schedule/spec.ts"):
            with self.subTest(c=c):
                self.assertIsNone(self.bash(c), c)

    def test_comando_raro_deja_pasar(self):
        for c in ("echo 'sin cerrar", "rm", "cp soloUno", "git", "sed -i", ")(", "cat <<EOF\nsin fin"):
            with self.subTest(c=c):
                rc, out = hook({"tool_name": "Bash", "tool_input": {"command": c}, "cwd": self.raiz})
                self.assertEqual((rc, out), (0, ""))  # ni pregunta ni avisa de un error interno


class Rapidez(Base):
    def test_tarda_poco(self):
        def medir(entrada, n=5):
            tiempos = []
            for _ in range(n):
                t0 = time.perf_counter()
                hook(entrada)
                tiempos.append(time.perf_counter() - t0)
            return sorted(tiempos)[n // 2]

        codigo = medir({"tool_name": "Edit", "tool_input": {"file_path": self.r("backend/app/servicio.py")}})
        test = medir({"tool_name": "Edit", "tool_input": {"file_path": self.r("backend/tests/test_base.py")}})
        bash = medir({"tool_name": "Bash", "tool_input": {"command": "rm -rf backend/tests"}, "cwd": self.raiz})
        print(f"\n  mediana: código {codigo * 1000:.0f} ms · test {test * 1000:.0f} ms · bash rm -rf {bash * 1000:.0f} ms",
              file=sys.stderr)
        self.assertLess(max(codigo, test, bash), 0.5)  # holgado para máquinas cargadas; lo típico, < 100 ms


if __name__ == "__main__":
    unittest.main(verbosity=1)
