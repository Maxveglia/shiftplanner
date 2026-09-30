#!/usr/bin/env python3
"""PreToolUse(Edit|Write|MultiEdit|NotebookEdit|Bash): los tests que ya existen no se tocan sin Max.

Medido en ImpossibleBench (arXiv 2510.20270): cuando un modelo hace trampa para
que pasen los tests, más del 79 % de las veces lo hace EDITANDO los tests. La
regla: crear tests nuevos, sí; cambiar o borrar un test que YA EXISTE en la base
de la rama pide el OK de Max con `permissionDecision: "ask"`. Un test creado en
esta misma rama se edita libremente. Y lo que cambia QUÉ tests corren (apagarlos
sin tocarlos) pide el OK siempre, aunque sea nuevo.

La base: `git merge-base HEAD origin/main`; si no se puede calcular (clon
superficial), `origin/main` tal cual; si no hay origin/main, lo mismo con `main`; si
no hay ninguna, deja pasar.

Qué es un test (ruta relativa a la raíz del checkout; con la caja real del disco,
porque en APFS `Format.test.TS` es el mismo fichero que `format.test.ts`):
  - `backend/tests/**` (incluye `known_gap.py`) y cualquier `conftest.py`;
  - `frontend/**/*.test.{ts,tsx,js,jsx,mts,cts,mjs,cjs}` y `frontend/**/*.spec.*`
    (`lib/schedule/spec.ts` NO: es código);
  - `frontend/src/test/**`: `knownGap.ts` es el interruptor `it.fails` de los huecos
    conocidos y `rotaBench`/`rotaQuality` son las aserciones del banco;
  - `**/__tests__/**`, `**/__snapshots__/**`, `.claude/hooks/tests/**`.
Qué cambia qué tests corren (pide el OK al crearlo o cambiarlo, exista o no en main):
  - cualquier `conftest.py` (puede vaciar la colección);
  - `backend/**/{pytest.ini,.pytest.ini,tox.ini,setup.cfg}` (pytest.ini manda sobre
    pyproject.toml) y `frontend/vitest.config.*` (su `include`);
  - `backend/**/pyproject.toml` solo si el cambio toca pytest: un Edit cuyo texto
    viejo o nuevo nombra `tool.pytest`, `addopts`, `testpaths`, `--ignore`,
    `--deselect`, `-k`, `collect_ignore`, `python_files/classes/functions`,
    `norecursedirs` o `xfail_strict`; un Write que cambia la sección `[tool.pytest…]`
    respecto a la base; un Bash que lo escribe con esas palabras en el comando.
NO `.claude/evals/**`: la routine semanal los edita sin nadie delante (en `-p` un
«ask» es un «deny»).

Checkout = `backend/app/main.py` + `frontend/src` (la misma definición que sp-test y
verde-de-verdad). La raíz se busca subiendo desde el FICHERO, no desde el cwd: la sesión
puede estar en BASE editando un worktree del scratchpad, y la base es la de ese
worktree. Fuera de un checkout de ShiftPlanner no hace nada.

Bash (lo habitual, sin pretender cubrirlo todo; se parsea con shlex como guardia-bash,
los heredocs solo se abren con un `<<` fuera de comillas):
  - `sed`/`gsed -i`, `perl -i`, `ruby -i`, `awk -i inplace` sobre un test;
  - redirección `>`, `>>`, `>|`, `&>`, `<>` a un test (también la de un heredoc);
  - `tee [-a]`, `dd of=`, `ln -f`; `cp`/`install`/`rsync`/`mv`/`git mv` cuyo destino
    es un test que existe (a un directorio: el mismo nombre dentro; `-r` de un
    directorio: sus ficheros); `mv`/`git mv` de un test (lo quita de su sitio);
    `rsync --delete`;
  - `rm`/`git rm`/`unlink`/`shred`/`truncate` de un test o de un directorio con tests;
  - `git checkout [<rev>] -- <ruta>`, `git restore [--source=…] <ruta>` (sin `--staged`
    solo). Con revisión, siempre. Sin revisión restauran desde el ÍNDICE: pregunta si y
    solo si lo que se va a escribir (el blob del índice) no es el test de main;
  - `git apply` y `patch` con el parche en un fichero, por `<` o en un heredoc;
  - `python -c`, `node -e`, `perl -e` o un heredoc a `python -`, que abren un test en
    escritura, lo borran, lo renombran o hacen `rmtree` de su carpeta (mejor esfuerzo:
    literal de ruta + llamada de escritura en el mismo código);
  - lo anterior dentro de `( … )`, `$( … )`, `bash -c '…'`/`sh -c`/`eval` o de un heredoc
    a `bash`; con `cd` (que no sale de su subshell ni de una tubería), `git -C`,
    variables asignadas en el mismo comando (`WT=…; … $WT/…`) y globs.
Lo que NO cubre (se deja pasar):
  - un script en fichero (`python3 arregla.py`, `node x.mjs`) o código por tubería
    (`… | python3`); rutas que el código construye (`os.path.join`, `Path(a) / b`);
  - `find … -delete`/`-exec`, `xargs`, `git stash`/`reset`/`clean`/`switch`, las
    comillas invertidas y `$(…)` cuyo resultado es la ruta;
  - formateadores y linters que reescriben (`prettier --write`, `ruff --fix`, `black`):
    cambian la forma, no qué se comprueba;
  - apagar tests por el entorno (`PYTEST_ADDOPTS`) o por la línea de comandos;
  - sesiones que no cargan `.claude/settings.json` del repo (arrancadas en `~`), salvo
    que Max registre también la copia de usuario con `--usuario`.
Falso positivo conocido (mejor pasarse): un `python -c`/heredoc que lee un test y
escribe OTRO fichero pregunta igual.

Rápido: sin git salvo que haya una ruta candidata (dos llamadas: la base y ls-tree;
tres al restaurar desde el índice). Todo lo que no entiende o le falla lo deja pasar:
un guardián roto no puede bloquear (un error inesperado sale como `systemMessage`).

El «ask» (Claude Code 2.1.284): en sesión interactiva pregunta a Max en todos los modos,
también en auto (desde 2.1.211 el clasificador no puede aprobarlo en silencio) y en los
subagentes (el aviso sale en la sesión principal). En `claude -p` no hay a quién preguntar
y es un «deny». El motivo del «ask» lo ve Max, no el modelo; al modelo le llega en
`additionalContext` qué hacer si Max dice que no.
"""

import json
import os
import re
import shlex
import sys

OPERADORES = {"&&", "||", ";", "|", "&", "|&", ";;", "(", ")", "\n"}
RED_ESCRITURA = {">", ">>", ">|", "&>", "&>>", "<>"}
ENVOLTORIOS = {"env", "time", "command", "nice", "exec", "sudo", "nohup", "builtin",
               "{", "}", "!", "then", "do", "else", "elif", "if", "while", "until"}
INTERPRETES_SHELL = {"bash", "sh", "zsh", "dash", "ksh"}
TEST_JS = re.compile(r"\.test\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$", re.I)
SPEC_JS = re.compile(r"\.spec\.[a-z0-9]+$", re.I)
CONFIG_BACKEND = {"pytest.ini", ".pytest.ini", "tox.ini", "setup.cfg"}
CLAVES_PYTEST = re.compile(
    r"tool\.pytest|\[pytest\]|\baddopts\b|\btestpaths\b|--ignore|--deselect|(?<![\w-])-k\b|collect_ignore"
    r"|python_files|python_classes|python_functions|norecursedirs|xfail_strict", re.I)
VARIABLE = re.compile(r"\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))")
# Código que escribe, borra o renombra un fichero (python, node, perl, ruby).
ESCRIBE = re.compile(
    r"write_text|write_bytes|(?<!stdout)(?<!stderr)\.write\(|writelines|\bunlink|\bos\.remove\(|rmtree"
    r"|os\.replace\(|\.rename\(|shutil\.(?:move|copy)|\btruncate\(|writeFile|appendFile|rmSync|unlinkSync"
    r"|renameSync|copyFile|\bopen\(\s*[^,()]+,\s*(?:mode\s*=\s*)?['\"][rbt]*[wax+]"
    r"|\.open\(\s*(?:mode\s*=\s*)?['\"][rbt]*[wax+]|openSync\([^,()]+,\s*['\"][wa]"
)
LITERAL = re.compile(r"'([^'\n\\]+)'|\"([^\"\n\\]+)\"")


# ---------------------------------------------------------------- checkout, caja y base

def es_checkout(d):
    return os.path.isfile(os.path.join(d, "backend", "app", "main.py")) and os.path.isdir(
        os.path.join(d, "frontend", "src"))


_raices = {}


def raiz_shiftplanner(d):
    d = os.path.realpath(d)
    vistos, r = [], None
    for _ in range(25):
        if d in _raices:
            r = _raices[d]
            break
        vistos.append(d)
        if es_checkout(d):
            r = d
            break
        padre = os.path.dirname(d)
        if padre == d:
            break
        d = padre
    for v in vistos:
        _raices[v] = r
    return r


_listados = {}


def caja_real(raiz, rel):
    """`rel` con la caja que tiene en el disco (APFS no distingue mayúsculas).

    Solo corrige un componente que existe con otra caja; en un disco que sí distingue
    (la nube), `TESTS` no existe y se queda como está."""
    if rel == ".":
        return rel
    actual, salida = raiz, []
    partes = rel.split(os.sep)
    for k, p in enumerate(partes):
        if not os.path.lexists(os.path.join(actual, p)):
            salida.extend(partes[k:])
            break
        if actual not in _listados:
            try:
                _listados[actual] = os.listdir(actual)
            except OSError:
                _listados[actual] = None
        nombres = _listados[actual]
        if nombres is not None and p not in nombres:
            import unicodedata

            clave = unicodedata.normalize("NFC", p).casefold()
            p = next((n for n in nombres if unicodedata.normalize("NFC", n).casefold() == clave), p)
        salida.append(p)
        actual = os.path.join(actual, p)
    return "/".join(salida)


def normalizar(ruta):
    """(raíz del checkout, ruta relativa con su caja real) o None si no es de ShiftPlanner."""
    real = os.path.realpath(ruta)
    raiz = raiz_shiftplanner(real if os.path.isdir(real) else os.path.dirname(real))
    if raiz is None:
        return None
    rel = os.path.relpath(real, raiz)
    if rel == ".." or rel.startswith(".." + os.sep):
        return None
    return raiz, caja_real(raiz, rel)


def git(d, *args):
    import subprocess

    r = subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
         "--no-optional-locks", "-C", d, *args],
        capture_output=True, text=True, timeout=3, stdin=subprocess.DEVNULL,
        env={**os.environ, "GIT_NO_LAZY_FETCH": "1", "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0",
             "GIT_LITERAL_PATHSPECS": "1"},
    )
    return r.stdout if r.returncode == 0 else None


_bases = {}


def base(raiz):
    """El commit de la base de la rama del checkout, o None (y entonces no se protege nada)."""
    if raiz not in _bases:
        mb = None
        for rama in ("origin/main", "main"):
            salida = git(raiz, "merge-base", "HEAD", rama) or git(raiz, "rev-parse", "--verify", "-q",
                                                                    rama + "^{commit}")
            if salida and salida.strip():
                mb = salida.strip()
                break
        _bases[raiz] = mb
    return _bases[raiz]


def es_config(rel):
    """¿Decide qué tests corren? (se pregunta al crearlo o cambiarlo, aunque sea nuevo)."""
    rel = rel.replace(os.sep, "/")
    if rel.startswith(".claude/evals/"):
        return False
    partes = rel.split("/")
    nombre = partes[-1].lower()
    return (nombre == "conftest.py"
            or (partes[0] == "backend" and nombre in CONFIG_BACKEND)
            or (len(partes) == 2 and partes[0] == "frontend" and nombre.startswith("vitest.config.")))


def es_pyproject(rel):
    partes = rel.replace(os.sep, "/").split("/")
    return partes[0] == "backend" and partes[-1].lower() == "pyproject.toml"


def es_test(rel):
    rel = rel.replace(os.sep, "/")
    if rel == ".claude/evals" or rel.startswith(".claude/evals/"):
        return False
    partes = rel.split("/")
    nombre = partes[-1]
    if rel.startswith(("backend/tests/", ".claude/hooks/tests/", "frontend/src/test/")):
        return True
    if "__tests__" in partes[:-1] or "__snapshots__" in partes[:-1] or es_config(rel):
        return True
    return partes[0] == "frontend" and bool(TEST_JS.search(nombre) or SPEC_JS.search(nombre))


def ls_tree(raiz, rev, rels):
    """{ruta: blob} de los ficheros de `rev` en o bajo `rels`."""
    salida = git(raiz, "ls-tree", "-r", "-z", rev, "--", *rels) or ""
    fuera = {}
    for linea in salida.split("\0"):
        cabeza, _, ruta = linea.partition("\t")
        if ruta:
            fuera[ruta] = cabeza.split(" ")[2]
    return fuera


def ls_files(raiz, rels):
    """{ruta: blob} del ÍNDICE en o bajo `rels` (un conflicto sale como «conflicto»)."""
    salida = git(raiz, "ls-files", "-s", "-z", "--", *rels) or ""
    fuera = {}
    for linea in salida.split("\0"):
        cabeza, _, ruta = linea.partition("\t")
        if ruta:
            _, blob, etapa = cabeza.split(" ")
            fuera[ruta] = blob if etapa == "0" else "conflicto"
    return fuera


def debajo(ruta, rel):
    return rel == "." or ruta == rel or ruta.startswith(rel + "/")


def evaluar(candidatos, texto=""):
    """[(rel, raíz, clase, cómo)] de lo que pide el OK de Max.

    candidatos: [(ruta absoluta, tipo, cómo, fuente)], tipo «escribe» (crea o cambia
    ese fichero), «borra» (el fichero o todo lo que haya debajo) o «restaura» (git
    checkout/restore; fuente None = desde el índice). clase «test» o «config»."""
    hallados, por_raiz = [], {}
    for ruta, tipo, como, fuente in candidatos:
        n = normalizar(ruta)
        if not n:
            continue
        raiz, rel = n
        if tipo == "escribe":
            if es_config(rel):
                hallados.append((rel, raiz, "config", como))
            elif es_pyproject(rel):
                if CLAVES_PYTEST.search(texto):
                    hallados.append((rel, raiz, "config", como))
            elif es_test(rel):
                por_raiz.setdefault(raiz, []).append((rel, tipo, como, fuente))
        else:
            real = os.path.join(raiz, rel)
            if rel == "." or os.path.isdir(real) or not os.path.lexists(real) or es_test(rel):
                por_raiz.setdefault(raiz, []).append((rel, tipo, como, fuente))
    for raiz, lista in por_raiz.items():
        mb = base(raiz)
        if not mb:
            continue
        en_base = ls_tree(raiz, mb, sorted({c[0] for c in lista}))
        desde_indice = sorted({c[0] for c in lista if c[1] == "restaura" and c[3] is None})
        indice = ls_files(raiz, desde_indice) if desde_indice else {}
        for rel, tipo, como, fuente in lista:
            for ruta, blob in en_base.items():
                if not debajo(ruta, rel) or not es_test(ruta):
                    continue
                if tipo == "restaura" and fuente is None and indice.get(ruta, blob) == blob:
                    continue  # desde el índice se escribiría el test de main (o nada): no lo cambia
                hallados.append((ruta, raiz, "test", como))
    vistos, unicos = set(), []
    for h in hallados:
        if (h[0], h[1]) not in vistos:
            vistos.add((h[0], h[1]))
            unicos.append(h)
    return unicos


# ---------------------------------------------------------------- Bash: léxico

def separar_heredocs(texto):
    """(comando sin comentarios ni cuerpos de heredocs, [cuerpos en orden]).

    Recorre respetando comillas: `print(1 << 2)` entre comillas no abre un heredoc, ni
    `"#1"` es un comentario. El cuerpo empieza en la línea siguiente al `<<`."""
    fuera, cuerpos, pendientes = [], [], []
    i, n, comilla = 0, len(texto), None
    while i < n:
        c = texto[i]
        if comilla == "'":
            fuera.append(c)
            i += 1
            if c == "'":
                comilla = None
            continue
        if comilla == '"':
            if c == "\\" and i + 1 < n:
                fuera.append(texto[i:i + 2])
                i += 2
                continue
            fuera.append(c)
            i += 1
            if c == '"':
                comilla = None
            continue
        if c == "\\" and i + 1 < n:
            fuera.append(texto[i:i + 2])
            i += 2
            continue
        if c in "'\"":
            comilla = c
            fuera.append(c)
            i += 1
            continue
        if c == "#" and (i == 0 or texto[i - 1] in " \t\n;&|()"):
            fin = texto.find("\n", i)  # comentario: fuera (un `#` entre comillas no lo es)
            i = n if fin < 0 else fin
            continue
        if texto.startswith("<<", i) and not texto.startswith("<<<", i):
            j = i + 2
            quitar = j < n and texto[j] == "-"
            j += 1 if quitar else 0
            while j < n and texto[j] in " \t":
                j += 1
            k, delim = j, []
            while k < n and texto[k] not in " \t\n;&|<>()":
                ch = texto[k]
                if ch in "'\"":
                    fin = texto.find(ch, k + 1)
                    fin = n if fin < 0 else fin
                    delim.append(texto[k + 1:fin])
                    k = fin + 1
                elif ch == "\\" and k + 1 < n:
                    delim.append(texto[k + 1])
                    k += 2
                else:
                    delim.append(ch)
                    k += 1
            if k > j:
                pendientes.append(("".join(delim), quitar))
            fuera.append(texto[i:k])
            i = k
            continue
        if c == "\n" and pendientes:
            fuera.append(c)
            i += 1
            for delim, quitar in pendientes:
                cuerpo = []
                while i < n:
                    fin = texto.find("\n", i)
                    fin = n if fin < 0 else fin
                    linea = texto[i:fin]
                    i = fin + 1
                    if (linea.lstrip("\t") if quitar else linea) == delim:
                        break
                    cuerpo.append(linea)
                cuerpos.append("\n".join(cuerpo))
            pendientes = []
            continue
        fuera.append(c)
        i += 1
    return "".join(fuera), cuerpos


PUNTUACION = "();<>|&\n"
# shlex junta las rachas de puntuación (`);`, `)\n`, `&&(`): se parten en operadores de bash.
PIEZAS = sorted(["&&", "||", ";;", "|&", "&>>", ">>", "&>", ">|", "<<<", "<<", "<>", ">&", "<&",
                 ";", "|", "&", "(", ")", "<", ">", "\n"], key=len, reverse=True)


def partir(tok):
    if not tok or any(c not in PUNTUACION for c in tok):
        return [tok]
    piezas, i = [], 0
    while i < len(tok):
        pieza = next((p for p in PIEZAS if tok.startswith(p, i)), tok[i])
        piezas.append(pieza)
        i += len(pieza)
    return piezas


def elementos(texto):
    """[("seg", palabras, operador que sigue) | ("abre",) | ("cierra",)] del comando."""
    lex = shlex.shlex(texto.replace("\\\n", " "), posix=True, punctuation_chars="();<>|&\n")
    lex.whitespace = " \t\r"
    lex.whitespace_split = True
    lex.commenters = ""
    salida, actual = [], []
    try:
        for tok in (p for t in lex for p in partir(t)):  # los comentarios ya los quitó separar_heredocs
            if tok in OPERADORES:
                salida.append(("seg", actual, tok))
                actual = []
                if tok == "(":
                    salida.append(("abre",))
                elif tok == ")":
                    salida.append(("cierra",))
            else:
                actual.append(tok)
    except ValueError:  # comillas sin cerrar ($'…', o un comando roto): se mira lo leído hasta ahí
        pass
    salida.append(("seg", actual, ""))
    return salida


def programa(palabras):
    i = 0
    while i < len(palabras):
        p = palabras[i]
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", p) or p in ENVOLTORIOS:
            i += 1
            continue
        break
    return palabras[i:]


def rutas_de_parche(texto, p):
    """Las rutas que toca un parche unificado; `p` = componentes a quitar (None: 0 y 1)."""
    rutas = set()
    for linea in texto.splitlines():
        if linea.startswith("diff --git "):
            partes = linea.split()[2:4]
        elif linea.startswith(("--- ", "+++ ")):
            partes = [linea[4:].split("\t")[0].strip()]
        elif linea.startswith(("rename from ", "rename to ", "copy to ")):
            partes = [linea.split(" ", 2)[2].strip()]
            rutas.add(partes[0])
            continue
        else:
            continue
        for x in partes:
            if not x or x == "/dev/null":
                continue
            comps = x.split("/")
            for q in ((0, 1) if p is None else (p,)):
                if len(comps) > q:
                    rutas.add("/".join(comps[q:]))
    return rutas


def leer(ruta, tope=2_000_000):
    try:
        with open(ruta, encoding="utf-8", errors="replace") as f:
            return f.read(tope)
    except (OSError, ValueError):
        return ""


# ---------------------------------------------------------------- Bash: análisis

class Analisis:
    def __init__(self, cwd, texto):
        self.cwd = cwd
        self.vars = {}
        self.texto = texto  # entero, heredocs incluidos: para las palabras de pytest en pyproject
        self.candidatos = []  # (ruta absoluta, tipo, cómo, fuente)

    def ruta(self, p, cwd=None):
        p = os.path.expanduser(p)
        return os.path.normpath(p if os.path.isabs(p) else os.path.join(cwd or self.cwd, p))

    def rutas(self, p, cwd=None):
        """La ruta, o lo que casa si es un glob (lo expande la shell después)."""
        r = self.ruta(p, cwd)
        if any(c in p for c in "*?["):
            import glob

            hallado = glob.glob(r, recursive=True)[:2000]
            if hallado:
                return hallado
        return [r]

    def anadir(self, p, como, tipo="escribe", cwd=None, fuente=None, solo_si_existe=False):
        if not p or p == "-" or re.match(r"^[^/]*:", p):  # stdout, o remoto de rsync/scp
            return
        for r in self.rutas(p, cwd):
            if solo_si_existe and not os.path.lexists(r):
                continue
            self.candidatos.append((r, tipo, como, fuente))

    def expandir(self, palabra):
        def sustituir(m):
            nombre = m.group(1) or m.group(2)
            return self.vars.get(nombre, os.environ.get(nombre, m.group(0)))

        return VARIABLE.sub(sustituir, palabra) if "$" in palabra else palabra

    # -------------------------------------------------------------- comando entero

    def comando(self, texto, profundidad=0):
        if profundidad > 3 or not texto.strip():
            return
        texto, cuerpos = separar_heredocs(texto)
        cuerpos = iter(cuerpos)
        pila, previo = [], ""
        for el in elementos(texto):
            if el[0] == "abre":  # subshell: lo que cambie dentro (cd, variables) no sale
                pila.append((self.cwd, dict(self.vars)))
                continue
            if el[0] == "cierra":
                if pila:
                    self.cwd, self.vars = pila.pop()
                continue
            _, palabras, op = el
            if palabras:
                en_tuberia = op in ("|", "|&") or previo in ("|", "|&")
                self.segmento([self.expandir(p) for p in palabras], cuerpos, profundidad, en_tuberia)
            previo = op

    def segmento(self, palabras, cuerpos, profundidad, en_tuberia):
        limpias, cuerpo, entrada, i = [], None, None, 0
        while i < len(palabras):
            p = palabras[i]
            siguiente = palabras[i + 1] if i + 1 < len(palabras) else ""
            if p in RED_ESCRITURA or (p == ">&" and siguiente and not siguiente.isdigit() and siguiente != "-"):
                if limpias and limpias[-1].isdigit():
                    limpias.pop()  # el descriptor de `2>`
                self.anadir(siguiente, f"la redirección `{p}`")
                i += 2
                continue
            if p in ("<", ">&", "<&"):
                if limpias and limpias[-1].isdigit():
                    limpias.pop()
                if p == "<":
                    entrada = self.ruta(siguiente) if siguiente else None
                i += 2
                continue
            if p == "<<<":
                cuerpo = siguiente
                i += 2
                continue
            if p == "<<":
                cuerpo = next(cuerpos, None)
                i += 2
                continue
            limpias.append(p)
            i += 1
        if not limpias:
            return
        if all(re.match(r"^[A-Za-z_]\w*=", p) for p in limpias) or (
            limpias[0] in ("export", "local", "declare") and all(re.match(r"^[A-Za-z_]\w*=", p) for p in limpias[1:])
        ):
            if not en_tuberia:
                for p in limpias:
                    if "=" in p:
                        k, v = p.split("=", 1)
                        self.vars[k] = v
            return
        prog = programa(limpias)
        if not prog:
            return
        nombre = os.path.basename(prog[0])
        args = prog[1:]
        if nombre in ("cd", "pushd"):
            if not en_tuberia:  # en una tubería cada comando es un subshell
                destino = args[0] if args and not args[0].startswith("-") else ("~" if not args else None)
                if destino:
                    self.cwd = self.ruta(destino)
            return
        manejador = MANEJADORES.get(nombre)
        if manejador:
            manejador(self, nombre, args, cuerpo, entrada, profundidad)
        elif nombre in INTERPRETES_SHELL or nombre == "eval":
            self.shell(nombre, args, cuerpo, profundidad)
        elif re.match(r"^(python[0-9.]*|node|perl|ruby|deno|bun)$", nombre):
            self.codigo(nombre, args, cuerpo)

    # -------------------------------------------------------------- por programa

    def shell(self, nombre, args, cuerpo, profundidad):
        if nombre == "eval":  # corre en esta misma shell
            self.comando(" ".join(args), profundidad + 1)
            return
        guardado = (self.cwd, dict(self.vars))  # otro proceso: su cd no vuelve
        script = None
        for j, a in enumerate(args):
            if a == "-c" or (a.startswith("-") and not a.startswith("--") and "c" in a[1:]):
                script = args[j + 1] if j + 1 < len(args) else None
                break
        else:
            script = cuerpo
        if script:
            self.comando(script, profundidad + 1)
        self.cwd, self.vars = guardado

    def codigo(self, nombre, args, cuerpo):
        textos = []
        for j, a in enumerate(args):
            if a in ("-c", "-e", "-E", "--eval", "-p", "--print") and j + 1 < len(args):
                textos.append(args[j + 1])
        if cuerpo is not None:
            textos.append(cuerpo)
        for texto in textos:
            if not ESCRIBE.search(texto):
                continue
            arbol = "rmtree" in texto or "rmSync" in texto
            for m in LITERAL.finditer(texto):
                lit = m.group(1) or m.group(2)
                if "/" in lit or lit.endswith((".py", ".ts", ".tsx", ".js", ".jsx")):
                    self.anadir(lit, f"código `{nombre}` que escribe")
                    if arbol:
                        self.anadir(lit, f"código `{nombre}` que borra", tipo="borra")

    def en_sitio(self, nombre, args, cuerpo, entrada, profundidad):
        """sed -i, perl -i, ruby -i, awk -i inplace: los ficheros que se reescriben."""
        if nombre in ("sed", "gsed"):
            activo = any(a == "--in-place" or a.startswith("--in-place=")
                         or (re.match(r"^-[A-Za-z]*i", a) and not a.startswith("--")) for a in args)
            salta = {"-e", "-f", "--expression", "--file"}
        elif nombre in ("perl", "ruby"):
            activo = any(re.match(r"^-[pnlawsFTtWXc0-9]*i", a) for a in args)
            if not activo:
                self.codigo(nombre, args, cuerpo)
                return
            salta = {"-e", "-E", "-M", "-I"}
        else:  # awk / gawk
            activo = any(a in ("--include=inplace", "-iinplace") for a in args) or any(
                a == "-i" and j + 1 < len(args) and args[j + 1] == "inplace" for j, a in enumerate(args))
            salta = {"-f", "-v", "-i"}
        if not activo:
            return
        j = 0
        while j < len(args):
            a = args[j]
            if a in salta:
                j += 2
                continue
            if not a.startswith("-"):
                self.anadir(a, f"`{nombre} -i`", solo_si_existe=True)
            j += 1

    def tee(self, nombre, args, cuerpo, entrada, profundidad):
        for a in args:
            if not a.startswith("-"):
                self.anadir(a, "`tee`")

    def dd(self, nombre, args, cuerpo, entrada, profundidad):
        for a in args:
            if a.startswith("of="):
                self.anadir(a[3:], "`dd of=`")

    def ln(self, nombre, args, cuerpo, entrada, profundidad):
        if not any(a == "--force" or (re.match(r"^-[a-zA-Z]*f", a) and not a.startswith("--")) for a in args):
            return  # sin -f, ln no pisa nada
        pos = [a for a in args if not a.startswith("-")]
        if len(pos) < 2:
            return
        destino = self.ruta(pos[-1])
        if os.path.isdir(destino) and not os.path.islink(destino):
            for f in pos[:-1]:
                self.candidatos.append((os.path.join(destino, os.path.basename(f.rstrip("/"))), "escribe", "`ln -f`", None))
        else:
            self.anadir(pos[-1], "`ln -f`")

    def borrar(self, nombre, args, cuerpo, entrada, profundidad, cwd=None, como=None):
        con_valor = {"-s", "-r", "--size", "--reference", "-n", "--iterations"} if nombre in ("truncate", "shred") else set()
        j, tras = 0, False
        while j < len(args):
            a = args[j]
            if a == "--" and not tras:
                tras = True
            elif not tras and a in con_valor:
                j += 1
            elif tras or not a.startswith("-"):
                self.anadir(a, como or f"`{nombre}`", tipo="borra", cwd=cwd)
            j += 1

    def copiar(self, nombre, args, cuerpo, entrada, profundidad, cwd=None, como=None):
        """cp/install/rsync/mv: el destino que se sobrescribe (y en mv, lo que se mueve)."""
        con_valor = {
            "cp": {"-t", "-S", "--target-directory", "--suffix"},
            "mv": {"-t", "-S", "--target-directory", "--suffix"},
            "install": {"-m", "-o", "-g", "-t", "-S", "--mode", "--owner", "--group", "--target-directory", "--suffix"},
            "rsync": {"-e", "-f", "-T", "--rsh", "--exclude", "--include", "--filter", "--exclude-from",
                      "--include-from", "--files-from", "--temp-dir", "--partial-dir", "--backup-dir",
                      "--compare-dest", "--copy-dest", "--link-dest", "--chmod", "--chown", "--suffix",
                      "--log-file", "--password-file", "--port", "--timeout", "--bwlimit", "--max-size",
                      "--min-size"},
        }.get(nombre, {"-t"})
        como = como or f"`{nombre}`"
        posicionales, destino_t, borra, j, tras = [], None, False, 0, False
        while j < len(args):
            a = args[j]
            if a == "--" and not tras:
                tras = True
            elif not tras and a in ("-t", "--target-directory") and j + 1 < len(args):
                destino_t = args[j + 1]
                j += 1
            elif not tras and a.startswith("--target-directory="):
                destino_t = a.split("=", 1)[1]
            elif not tras and a in con_valor:
                j += 1
            elif not tras and (a == "--del" or a.startswith("--delete")):
                borra = True
            elif tras or not a.startswith("-"):
                posicionales.append(a)
            j += 1
        if destino_t is None:
            if len(posicionales) < 2:
                return
            destino_t, fuentes = posicionales[-1], posicionales[:-1]
        else:
            fuentes = posicionales
        if nombre == "mv":  # lo movido desaparece de su sitio
            for f in fuentes:
                self.anadir(f, como, tipo="borra", cwd=cwd)
        destino = self.ruta(destino_t, cwd)
        a_directorio = os.path.isdir(destino) or destino_t.endswith("/") or len(fuentes) > 1
        if borra and nombre == "rsync":
            self.anadir(destino_t, "`rsync --delete`", tipo="borra", cwd=cwd)
        for f in fuentes:
            if re.match(r"^[^/]*:", f):
                continue
            for origen in self.rutas(f, cwd):
                if nombre == "rsync" and f.endswith("/"):
                    objetivo = destino
                elif a_directorio:
                    objetivo = os.path.join(destino, os.path.basename(origen.rstrip("/")))
                else:
                    objetivo = destino
                if os.path.isdir(origen):
                    n = 0
                    for carpeta, subcarpetas, ficheros in os.walk(origen):
                        subcarpetas[:] = [s for s in subcarpetas if s not in (".git", "node_modules", ".venv")]
                        for fichero in ficheros:
                            ruta = os.path.join(carpeta, fichero)
                            self.candidatos.append((os.path.join(objetivo, os.path.relpath(ruta, origen)),
                                                    "escribe", como, None))
                            n += 1
                        if n > 5000:
                            break
                else:
                    self.candidatos.append((objetivo, "escribe", como, None))

    def parche(self, textos, p, cwd, como):
        for texto in textos:
            for r in rutas_de_parche(texto, p):
                self.anadir(r, como, cwd=cwd)

    def patch(self, nombre, args, cuerpo, entrada, profundidad):
        p, cwd, textos, j = None, self.cwd, [], 0
        while j < len(args):
            a = args[j]
            if a in ("-p", "--strip") and j + 1 < len(args):
                p = int(args[j + 1]) if args[j + 1].isdigit() else None
                j += 2
                continue
            m = re.match(r"^(?:-p|--strip=)(\d+)$", a)
            if m:
                p = int(m.group(1))
            elif a in ("-d", "--directory") and j + 1 < len(args):
                cwd = self.ruta(args[j + 1])
                j += 1
            elif a in ("-i", "--input") and j + 1 < len(args):
                textos.append(leer(self.ruta(args[j + 1])))
                j += 1
            elif a.startswith("--dry-run"):
                return
            elif not a.startswith("-"):
                self.anadir(a, "`patch`")  # el fichero a parchear, si se nombra
            j += 1
        if cuerpo is not None:
            textos.append(cuerpo)
        if entrada:
            textos.append(leer(entrada))
        self.parche(textos, p, cwd, "`patch`")

    def git(self, nombre, args, cuerpo, entrada, profundidad):
        cwd, j = self.cwd, 0
        while j < len(args) and args[j].startswith("-"):
            if args[j] == "-C" and j + 1 < len(args):
                cwd = self.ruta(args[j + 1], cwd)
                j += 2
            elif args[j] in ("-c", "--git-dir", "--work-tree", "--namespace") and j + 1 < len(args):
                j += 2
            else:
                j += 1
        if j >= len(args):
            return
        sub, resto = args[j], args[j + 1:]
        if sub == "rm":
            if not any(a in ("-n", "--dry-run") for a in resto):
                self.borrar("rm", resto, cuerpo, entrada, profundidad, cwd=cwd, como="`git rm`")
        elif sub == "mv":
            if not any(a in ("-n", "--dry-run") for a in resto):
                self.copiar("mv", resto, cuerpo, entrada, profundidad, cwd=cwd, como="`git mv`")
        elif sub == "apply":
            if any(a in ("--check", "--stat", "--numstat", "--summary") for a in resto) and "--apply" not in resto:
                return
            p, textos = 1, []
            for a in resto:
                m = re.match(r"^-p(\d+)$", a)
                if m:
                    p = int(m.group(1))
                elif not a.startswith("-"):
                    textos.append(leer(self.ruta(a, cwd)))
            if cuerpo is not None:
                textos.append(cuerpo)
            if entrada:
                textos.append(leer(entrada))
            raiz = raiz_shiftplanner(cwd) or cwd  # las rutas del parche van desde la raíz
            self.parche(textos, p, raiz, "`git apply`")
        elif sub in ("checkout", "restore"):
            self.restaurar(sub, resto, cwd)

    def restaurar(self, sub, resto, cwd):
        staged = any(a in ("--staged", "-S") for a in resto)
        worktree = any(a in ("--worktree", "-W") for a in resto)
        if sub == "restore" and staged and not worktree:
            return  # solo el índice: el fichero no cambia
        antes, rutas = (resto[:resto.index("--")], resto[resto.index("--") + 1:]) if "--" in resto else (resto, None)
        sueltos, fuente, k = [], None, 0
        while k < len(antes):
            a = antes[k]
            if a in ("-s", "--source") and k + 1 < len(antes):
                fuente = antes[k + 1]
                k += 2
                continue
            if a.startswith("--source="):
                fuente = a.split("=", 1)[1]
            elif a in ("-b", "-B", "--orphan", "--conflict", "--pathspec-from-file") and k + 1 < len(antes):
                k += 2
                continue
            elif not a.startswith("-"):
                sueltos.append(a)
            k += 1
        if rutas is None:
            rutas = sueltos
            if sub == "checkout":  # sin `--`, lo que no existe en el disco es la revisión
                fuente = next((a for a in sueltos if not os.path.lexists(self.ruta(a, cwd))), fuente)
        elif sub == "checkout" and sueltos:
            fuente = sueltos[0]
        if sub == "restore" and staged and fuente is None:
            fuente = "HEAD"  # `restore --staged --worktree` sin --source copia HEAD
        for r in rutas:  # una rama (`git checkout main`) no es un test ni un directorio: no cuenta
            self.anadir(r, f"`git {sub}`", tipo="restaura", cwd=cwd, fuente=fuente)


MANEJADORES = {
    "sed": Analisis.en_sitio, "gsed": Analisis.en_sitio, "perl": Analisis.en_sitio, "ruby": Analisis.en_sitio,
    "awk": Analisis.en_sitio, "gawk": Analisis.en_sitio,
    "tee": Analisis.tee, "dd": Analisis.dd, "ln": Analisis.ln, "patch": Analisis.patch,
    "rm": Analisis.borrar, "unlink": Analisis.borrar, "shred": Analisis.borrar, "truncate": Analisis.borrar,
    "cp": Analisis.copiar, "install": Analisis.copiar, "rsync": Analisis.copiar, "mv": Analisis.copiar,
    "git": Analisis.git,
}


# ---------------------------------------------------------------- herramientas de edición

def seccion_pytest(texto):
    """Las líneas de las tablas `[tool.pytest…]` de un pyproject.toml, normalizadas."""
    dentro, lineas = False, []
    for linea in (texto or "").splitlines():
        s = linea.strip()
        if s.startswith("["):
            dentro = s.lstrip("[").startswith("tool.pytest")
        if dentro and s and not s.startswith("#"):
            lineas.append(s)
    return lineas


def edicion(herramienta, entrada, cwd):
    ruta = entrada.get("file_path") or entrada.get("notebook_path")
    if not isinstance(ruta, str) or not ruta:
        return []
    ruta = os.path.expanduser(ruta)
    ruta = ruta if os.path.isabs(ruta) else os.path.join(cwd, ruta)
    n = normalizar(ruta)
    if not n:
        return []
    raiz, rel = n
    if herramienta != "NotebookEdit" and es_pyproject(rel):
        if herramienta == "Write":
            mb = base(raiz)
            anterior = git(raiz, "cat-file", "blob", f"{mb}:{rel}") if mb else None
            if anterior is None and mb is None:
                return []
            cambia = seccion_pytest(entrada.get("content")) != seccion_pytest(anterior)
        else:
            trozos = [entrada.get("old_string"), entrada.get("new_string")]
            for e in entrada.get("edits") or []:
                if isinstance(e, dict):
                    trozos += [e.get("old_string"), e.get("new_string")]
            cambia = any(isinstance(t, str) and CLAVES_PYTEST.search(t) for t in trozos)
        return [(rel, raiz, "config", None)] if cambia else []
    if herramienta != "NotebookEdit" and es_config(rel):
        return [(rel, raiz, "config", None)]
    return evaluar([(ruta, "escribe", None, None)])


# ---------------------------------------------------------------- salida

def lista(rutas):
    return ", ".join(f"`{r}`" for r in rutas[:3]) + (f" y {len(rutas) - 3} más" if len(rutas) > 3 else "")


def motivo(hallados):
    tests = sorted({rel for rel, _, clase, _ in hallados if clase == "test"})
    config = sorted({rel for rel, _, clase, _ in hallados if clase == "config"})
    como = next((c for _, _, _, c in hallados if c), None)
    via = f" (con {como})" if como else ""
    frases, contexto = [], []
    if tests:
        uno = len(tests) == 1
        frases.append(f"{lista(tests)} {'es un test que ya existe' if uno else 'son tests que ya existen'} en main"
                      f"{via}. Cambiar{'lo' if uno else 'los'} o borrar{'lo' if uno else 'los'} necesita el OK de Max.")
        contexto.append(f"{lista(tests)} {'es un test que ya existe' if uno else 'son tests que ya existen'} en main")
    if config:
        uno = len(config) == 1
        frases.append(f"{lista(config)} {'cambia' if uno else 'cambian'} qué tests corren"
                      f"{'' if tests else via}. Cambiar{'lo' if uno else 'los'} necesita el OK de Max.")
        contexto.append(f"{lista(config)} {'cambia' if uno else 'cambian'} qué tests corren")
    para_max = (
        "proteger-tests: " + " ".join(frases) + " Si el test contradice lo que se pide, no lo toques ni lo "
        "apagues: responde `BLOQUEADO: <test> contradice <requisito>` y explica por qué."
    )
    para_modelo = (
        "proteger-tests: " + "; ".join(contexto) + "; he pedido a Max que confirme este cambio. Si lo aprueba, "
        "sigue. Si lo rechaza, o si el test contradice lo que se pide, no lo toques ni lo esquives (nada de "
        "skip/xfail, ni apagarlo desde la configuración, ni tallar el código para que pase, ni cambiarlo por otra "
        "vía): responde `BLOQUEADO: <test> contradice <requisito>` y explica por qué."
    )
    return para_max, para_modelo


def main():
    if "--usuario" in sys.argv:
        # Copia registrada a nivel de usuario: callarse si el proyecto ya registra el hook.
        proyecto = os.environ.get("CLAUDE_PROJECT_DIR", "")
        if proyecto and es_checkout(proyecto):
            try:
                with open(os.path.join(proyecto, ".claude", "settings.json"), encoding="utf-8") as f:
                    if "proteger-tests" in f.read():
                        return
            except OSError:
                pass
    try:
        datos = json.load(sys.stdin)
    except ValueError:
        return
    if not isinstance(datos, dict):
        return
    herramienta = datos.get("tool_name") or ""
    entrada = datos.get("tool_input") or {}
    cwd = datos.get("cwd") or os.getcwd()
    if not isinstance(entrada, dict):
        return
    if herramienta == "Bash":
        comando = entrada.get("command") or ""
        analisis = Analisis(cwd, comando)
        analisis.comando(comando)
        hallados = evaluar(analisis.candidatos, comando) if analisis.candidatos else []
    elif herramienta in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        hallados = edicion(herramienta, entrada, cwd)
    else:
        return
    if not hallados:
        return
    para_max, para_modelo = motivo(hallados)
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
                "permissionDecisionReason": para_max,
                "additionalContext": para_modelo,
            }
        },
        sys.stdout,
        ensure_ascii=False,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 — un guardián roto deja pasar
        try:
            json.dump({"systemMessage": f"proteger-tests: error interno ({type(e).__name__}: {e}); dejo pasar."},
                      sys.stdout, ensure_ascii=False)
        except Exception:  # noqa: BLE001
            pass
    sys.exit(0)
