// What the model is ALLOWED to say, and how little of it we believe.
//
// A proposed calendar arrives as text. Before any rule is applied to it, the
// shape has to be trusted -- `validateSchedule` assumes well-formed
// assignments, and asking it to also cope with a null date or an hour of "9am"
// would blur the line between "this rota is illegal" and "this JSON is junk".
// So there are two gates, and this is the first one.
//
// TWO DESIGN DECISIONS, both about not asking a language model to do sums:
//
// 1. **Times are "HH:MM", never minutes from midnight.** `startMin: 540` is
//    arithmetic; "09:00" is a fact. A model writes the clock reliably and
//    computes offsets badly, and every offset it got wrong would be a shift at
//    the wrong hour that still looked perfectly valid.
//
// 2. **It emits five fields, not fourteen.** Everything derived -- paid hours,
//    overtime, cost, colour -- is computed from these. That is a third of the
//    output tokens, and it removes the entire class of failure where a rota is
//    legal but its own totals are wrong.

import { windowFromAnswer } from './questions';

/** One shift exactly as the model is asked to state it. */
export interface ProposedShift {
  employeeId: string;
  /** The local date the shift STARTS on, YYYY-MM-DD. */
  date: string;
  /** "HH:MM", 24-hour. */
  start: string;
  /**
   * "HH:MM", 24-hour. At or before `start` means it runs past midnight -- the
   * same reading `windowFromAnswer` gives a business open until two, and the
   * same one the shift templates have always had.
   */
  end: string;
  /** Null when the model has no template to point at; a band is derived. */
  templateId?: string | null;
}

export type RejectionReason =
  | 'not_an_object'
  | 'missing_employee'
  | 'malformed_date'
  | 'malformed_time'
  /** Start and end are the same time: a typo, never a 24-hour shift. */
  | 'zero_length';

export interface RejectedShift {
  reason: RejectionReason;
  /** The offending item, for telling the model what to fix on the retry. */
  raw: unknown;
}

export interface ParsedProposal {
  /** Well-formed shifts, with times resolved to minutes. Not yet priced. */
  shifts: BareAssignment[];
  /** What was thrown away, and why. */
  rejected: RejectedShift[];
}

/**
 * An assignment with only the fields the model supplied.
 *
 * Deliberately NOT an `Assignment`: the derived half is missing, and a type
 * that pretended otherwise would let an unpriced shift reach the calendar with
 * silent zeros for everybody's hours and pay.
 */
export interface BareAssignment {
  employeeId: string;
  date: string;
  startMin: number;
  endMin: number;
  templateId: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]?\d|2[0-4]):([0-5]\d)$/;

/** "HH:MM" to minutes from midnight, or null if it is not a clock time. */
function clockToMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = TIME.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  // "24:30" is not a time. "24:00" is midnight at the END of a day and is how
  // the intake already writes a business that closes on the hour.
  if (hours === 24 && mins !== 0) return null;
  return hours * 60 + mins;
}

/** A real calendar date, not merely a well-shaped one. */
function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
  );
}

/**
 * Read a proposal, keeping what is well-formed and naming what is not.
 *
 * Malformed items are DROPPED, not thrown on. One bad row out of ninety is not
 * a reason to discard a month of work: the caller retries just the rejects, and
 * `rejected` carries the reason so the retry can say what was wrong instead of
 * asking again and hoping.
 */
export function parseProposal(raw: unknown): ParsedProposal {
  const shifts: BareAssignment[] = [];
  const rejected: RejectedShift[] = [];

  if (!Array.isArray(raw)) return { shifts, rejected };

  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      rejected.push({ reason: 'not_an_object', raw: item });
      continue;
    }
    const r = item as Record<string, unknown>;

    if (typeof r.employeeId !== 'string' || !r.employeeId.trim()) {
      rejected.push({ reason: 'missing_employee', raw: item });
      continue;
    }
    if (!isRealDate(r.date)) {
      rejected.push({ reason: 'malformed_date', raw: item });
      continue;
    }
    const startMin = clockToMinutes(r.start);
    const endMin = clockToMinutes(r.end);
    if (startMin == null || endMin == null) {
      rejected.push({ reason: 'malformed_time', raw: item });
      continue;
    }
    // Resolves an overnight the one way this codebase resolves it. Equal ends
    // come back null -- "opens at ten, closes at ten" is somebody filling the
    // second box before they meant to, not a shift around the clock.
    const window = windowFromAnswer(startMin, endMin);
    if (!window) {
      rejected.push({ reason: 'zero_length', raw: item });
      continue;
    }

    shifts.push({
      employeeId: r.employeeId.trim(),
      date: r.date,
      startMin: window.openMin,
      endMin: window.closeMin,
      templateId:
        typeof r.templateId === 'string' && r.templateId.trim()
          ? r.templateId.trim()
          : null,
    });
  }

  return { shifts, rejected };
}

/**
 * The shape the model is told to produce, as a JSON schema.
 *
 * Kept beside the parser on purpose: a schema that drifts from the reader is
 * how a field silently stops arriving. Flat, with no nesting and no unions --
 * `refine_intake.py` documents what the API does to a schema that reaches for
 * either, and this one has to survive being sent ninety times a month.
 */
export const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    shifts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          employeeId: {
            type: 'string',
            description: 'Exactly one of the employee ids you were given.',
          },
          date: { type: 'string', description: 'YYYY-MM-DD.' },
          start: { type: 'string', description: '24-hour "HH:MM".' },
          end: {
            type: 'string',
            description:
              '24-hour "HH:MM". Write it as spoken: a shift ending at two in '
              + 'the morning is "02:00", not "26:00".',
          },
          templateId: {
            type: 'string',
            description: 'One of the shift template ids, or omit it.',
          },
        },
        required: ['employeeId', 'date', 'start', 'end'],
      },
    },
  },
  required: ['shifts'],
} as const;
