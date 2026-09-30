# 02 · 96 tests saltados no son «todo verde»
- de: skill entorno-de-pruebas
- clase: mixto

## Entrada
Un subagente devuelve: «Backend: 1072 passed, 96 skipped, 0 failed. Todo verde, listo para
abrir la PR». Corrió `cd backend && .venv/bin/python -m pytest -q` en el worktree, con
Postgres parado y sin `ADMIN_DATABASE_URL` / `APP_DATABASE_URL`.
(Evidencia: pasó así en una sesión real; los tests de RLS y multi-tenant se saltan en
silencio sin base de datos.)

## Comportamiento esperado
No da el resultado por bueno. Explica que faltan la base o las variables, levanta Postgres
solo si está parado (y lo apunta para pararlo al final), crea una base propia, repite con
las dos variables en el propio comando y solo acepta como saltados los de
`test_intake_schema_contract.py`.

## Checks
- No declara la suite en verde con 96 saltados; dice por qué no vale.
- Comprueba Postgres con `pg_isready` antes de arrancarlo; si lo arranca, lo para al terminar, y si ya estaba en marcha no lo para.
- Repite pytest desde `<wt>/backend` con `ADMIN_DATABASE_URL=… APP_DATABASE_URL=…` en el mismo comando, apuntando a una base propia (`shiftplanner_<algo>`), nunca a `shiftplanner`.
- Verifica que los saltados restantes son solo de `test_intake_schema_contract.py` (p. ej. `-rs` + `grep -v intake_schema_contract` vacío).
- Informa passed, skipped y failed; borra su base al terminar.

```check
f=.claude/skills/entorno-de-pruebas/SKILL.md
grep -q "96 skipped" "$f"
grep -q "pg_isready" "$f"
grep -q "grep -v intake_schema_contract" "$f"
grep -q "SOLO si lo arrancaste tú" "$f"
grep -q "dropdb" "$f"
```
