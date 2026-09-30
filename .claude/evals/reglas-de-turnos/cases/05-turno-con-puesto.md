# 05 · Todo turno tiene puesto (parte de dominio)
- de: skill reglas-de-turnos
- clase: mixto
- brief: 7

## Entrada
«En el calendario guardado me salen barras grises que solo dicen "Turno". Antes de guardar
ponía "Noche". ¿Puede un turno quedarse sin puesto? ¿De dónde sale eso?»

## Comportamiento esperado
Todo turno tiene puesto. En esta app no existe una entidad «puesto»: el puesto es el nombre de
la plantilla (franja) de la que sale el turno o, si la generó la app, el de su banda horaria.
Hoy un turno sin plantilla vuelve del servidor como «Turno»/«Shift» gris con id `unknown`, y
eso le pasa a TODO turno de banda (`band-*`) al guardarlo, porque se envía sin plantilla. Es
un hueco conocido.

## Checks
- Empieza con «Skill: reglas-de-turnos».
- Explica que «puesto» hoy = nombre de plantilla o de banda (`Assignment.templateName`;
  `templateId`/`templateName`/`color` son obligatorios en `frontend/src/lib/schedule/types.ts`)
  y que no hay puestos ni habilidades aparte.
- Localiza el origen con fichero: `toShiftPayload` (`frontend/src/lib/schedule/persist.ts`)
  manda `shift_template_id: null` para todo id que no sea un UUID (`band-*`, manuales,
  `unknown`); `assignment.shift_template_id` admite NULL y es ON DELETE SET NULL
  (`backend/app/models/assignment.py`); al leerlo, `orphanTemplate` le pone
  `roster.shift.untitled` («Turno»/«Shift»), gris, id `unknown`. Lo dice también la nota de
  `draftSync.ts` («an ad-hoc band goes up as null and comes back as an orphan»).
- Dice a quién afecta: a todo turno sintetizado por el generador, colocado a mano o añadido
  por un retoque, en cuanto pasa por el servidor; no solo a plantillas borradas.
- No confunde esta parte con la de la UI de la regla 7 (el color nunca es la única señal),
  que es de la skill `ui-movil-y-accesible`.
- Lo trata como HUECO CONOCIDO y no toca código de la app.
- Tests de este caso:
  - `frontend/src/lib/schedule/shiftPost.test.ts`: pasa «carries the name of the template it
    was cut from»; hueco conocido «carries a real post even when it has no template» y «keeps
    the name of its time band through a save and a reload» (hoy un «Noche» vuelve como «Turno»),
    los dos `knownGap`.
  - Sin contradicción con tests existentes.

```check
# Puesto de un turno sin plantilla y de un turno de banda tras guardarlo: hueco conocido.
# El fichero entero y no -t: un -t que no casa con ningún test sale con 0 y pasaría en silencio.
cd frontend && SP_EVALS=1 npx vitest run src/lib/schedule/shiftPost.test.ts
```
