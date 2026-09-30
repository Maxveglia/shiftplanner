#!/usr/bin/env python3
"""PreToolUse(Read): no leer entero un fichero enorme de ShiftPlanner.

DashboardPage.tsx tiene 3.500 líneas (~40k tokens) y business_profile.py 2.250.
Leerlos enteros para mirar una función llena el contexto y adelanta la
compactación, y después de compactar se vuelven a leer. Este hook deniega la
lectura SIN `limit` de un fichero de un checkout de ShiftPlanner que pase de
UMBRAL_LINEAS, y le dice al modelo cómo hacerlo: el índice con `sp-outline` y
el tramo con offset/limit. Un `limit` explícito siempre pasa: es la salida de
emergencia cuando de verdad hace falta entero.

Registrado en `.claude/settings.json` del repo. Casi todas las sesiones arrancan
en `~` y esas no lo cargan; registrarlo también a nivel de usuario lo decide Max
(toca `~/.claude`). Esa copia llevaría `--usuario`, que se calla cuando el
proyecto es un checkout que ya lo registra, para no responder dos veces.

Cualquier error deja pasar la lectura: un guardián roto no puede bloquear.
"""

import json
import os
import sys

UMBRAL_LINEAS = 800
# Por encima de esto, el tamaño en bytes ya dice que es grande sin contar líneas.
BYTES_SEGURO = 24_000


def raiz_shiftplanner(ruta):
    """El checkout de ShiftPlanner que contiene `ruta`, o None."""
    d = os.path.dirname(ruta)
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


def proyecto_ya_lo_registra():
    # Una sesión arrancada en `~` tiene CLAUDE_PROJECT_DIR=~ y su settings.json es el de
    # usuario: solo cuenta un proyecto que sea un checkout de ShiftPlanner.
    proyecto = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not proyecto or not os.path.isfile(os.path.join(proyecto, "backend", "app", "main.py")):
        return False
    try:
        with open(os.path.join(proyecto, ".claude", "settings.json"), encoding="utf-8") as f:
            return "guardia-lectura" in f.read()
    except OSError:
        return False


def sp_outline(raiz):
    propio = os.path.join(raiz, ".claude", "bin", "sp-outline")
    if os.path.isfile(propio):
        return propio
    # Rama vieja sin arneses: el de la copia desde la que corre este hook.
    aqui = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
    return os.path.join(aqui, "bin", "sp-outline")


def main():
    if "--usuario" in sys.argv and proyecto_ya_lo_registra():
        return
    datos = json.load(sys.stdin)
    entrada = datos.get("tool_input") or {}
    ruta = entrada.get("file_path") or ""
    if not ruta or entrada.get("limit"):
        return
    if not os.path.isfile(ruta) or os.path.getsize(ruta) < BYTES_SEGURO:
        return
    raiz = raiz_shiftplanner(os.path.realpath(ruta))
    if raiz is None:
        return
    with open(ruta, "rb") as f:
        contenido = f.read()
    if b"\0" in contenido[:4096]:  # imagen, pdf: Read los trata aparte
        return
    lineas = contenido.count(b"\n") + (0 if contenido.endswith(b"\n") else 1)
    desde = int(entrada.get("offset") or 1)
    if lineas - desde + 1 <= UMBRAL_LINEAS:
        return
    tokens = len(contenido) // 3500
    nombre = os.path.basename(ruta)
    motivo = (
        f"{nombre} tiene {lineas:,} líneas (~{tokens}k tokens)".replace(",", ".")
        + ". No lo leas entero: mira su índice con "
        f"`{sp_outline(raiz)} {ruta}` y lee solo el tramo que necesitas con offset/limit "
        "(o localízalo antes con `grep -n`). Si de verdad lo necesitas entero, "
        "repite la lectura con un limit explícito."
    )
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": motivo,
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
