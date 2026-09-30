import axios, { AxiosError } from 'axios';
import { translate } from './i18n/core';

export const TOKEN_STORAGE_KEY = 'shiftplanner.token';
export const USER_STORAGE_KEY = 'shiftplanner.user';

/**
 * Where the API lives: empty in production, where the page and the API share
 * one origin (see the Dockerfile), and `http://localhost:8000` on a
 * developer's machine. Also where an <img> loads a dish's photo from
 * (lib/menu/photo.ts), which is a plain GET the browser makes on its own.
 */
export const API_ORIGIN: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

const baseURL = API_ORIGIN + '/api/v1';

/**
 * How long an ordinary request may take before we call it lost.
 *
 * axios defaults to NO timeout, which is the wrong default for a browser: a
 * request that never comes back leaves a spinner spinning until the tab is
 * closed, and the manager cannot tell that from work still in progress. Thirty
 * seconds is far beyond any CRUD call this app makes.
 *
 * The two calls that ask Claude something get their own, longer deadlines at
 * the call site -- see `api/schedule.ts`. They are the only requests where a
 * slow answer is still a good answer.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

export const api = axios.create({
  baseURL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach the bearer token from localStorage on every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// A business's apps can be switched off while a page of one is open: its
// client folder changed (backend/app/clients/). From then on the server
// answers that app's routes with 403 `app_not_enabled`, and whoever holds the
// list of apps (auth/WorkspaceContext.tsx) is told, so it asks again and the
// app's screens go -- rather than every click meeting the same refusal until
// somebody thinks to reload.
const appNotEnabledListeners = new Set<() => void>();

export function onAppNotEnabled(listener: () => void): () => void {
  appNotEnabledListeners.add(listener);
  return () => {
    appNotEnabledListeners.delete(listener);
  };
}

// --- A session the server closed --------------------------------------------
//
// The server can end a session nobody here asked to end: the manager changed
// the till's tablet's password, or deleted it, or took an employee's access
// away (backend: session_epoch; the account re-read on every request). The
// next request is a 401, the session is dropped and the page goes to the
// sign-in -- which, without a word, looks like the app threw the person out
// for nothing. So the drop leaves a mark for the tab (sessionStorage: this
// tab only, gone with it), and the sign-in says "you were signed out" once.
// Signing out by choice (AuthContext's logout) leaves none, and clears one.

/** The mark, in this tab's sessionStorage. */
export const SESSION_ENDED_KEY = 'shiftplanner.sessionEnded';

type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** This tab's storage, or none: blocked, or not a browser. */
function tabStorage(): TabStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Leave the mark: the server ended a session that was open. */
export function markSessionEnded(storage: TabStorage | null = tabStorage()): void {
  try {
    storage?.setItem(SESSION_ENDED_KEY, '1');
  } catch {
    // Storage full or blocked: the sign-in says nothing, as before.
  }
}

/** Whether the mark is there. Reading does not take it away. */
export function sessionEnded(storage: TabStorage | null = tabStorage()): boolean {
  try {
    return storage?.getItem(SESSION_ENDED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Take the mark away: said once, or signed out by choice. */
export function clearSessionEnded(storage: TabStorage | null = tabStorage()): void {
  try {
    storage?.removeItem(SESSION_ENDED_KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * Whether a 401 ended a session: there was one (a token), and the refusal is
 * not the sign-in's own -- a wrong password on /login is a 401 too, and
 * nobody was signed in to be signed out.
 */
export function endsASession(hadToken: boolean, path: string): boolean {
  return hadToken && path !== '/login' && path !== '/signup';
}

// On 401, drop the stored session and bounce to the login page.
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 403 && errorCode(error) === 'app_not_enabled') {
      appNotEnabledListeners.forEach((listener) => listener());
    }
    if (error.response?.status === 401) {
      const hadToken = localStorage.getItem(TOKEN_STORAGE_KEY) !== null;
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(USER_STORAGE_KEY);
      // Avoid redirect loops if we are already on an auth page.
      const path = window.location.pathname;
      if (endsASession(hadToken, path)) markSessionEnded();
      if (path !== '/login' && path !== '/signup') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  },
);

/** The shape `backend/app/errors.py` sends: a code to translate, and English. */
interface ErrorDetail {
  code?: string;
  message?: string;
  params?: Record<string, string | number>;
}

/** The code the server named a failure with, if it named one. */
export function errorCode(error: unknown): string | undefined {
  if (!axios.isAxiosError(error)) return undefined;
  const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined;
  const { code } = detail as ErrorDetail;
  return typeof code === 'string' ? code : undefined;
}

/**
 * An axios failure as a sentence to show somebody.
 *
 * Three shapes arrive here and the order matters.
 *
 * An OBJECT with a `code` is the one to want: the server named what went wrong
 * and the sentence is written here, in the reader's language. Its `message` is
 * the English the server also sent, and it is what a code this bundle has never
 * heard of falls back to -- an older client against a newer server shows a
 * sentence in the wrong language rather than nothing at all.
 *
 * A bare STRING is a route that has not been given a code yet. It is English,
 * and it is exactly what every error was before codes existed, so nothing
 * breaks while the two live side by side.
 *
 * An ARRAY is FastAPI's own validation error, which no manager should ever see;
 * it is shown rather than swallowed because seeing it is the bug report.
 */
export function getErrorMessage(error: unknown, fallback?: string): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const named = detail as ErrorDetail;
      if (named.code) {
        const key = `errors.${named.code}`;
        const text = translate(key, named.params);
        if (text !== key) return text;
      }
      if (named.message) return named.message;
    }
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      // FastAPI validation errors: [{loc, msg, type}, ...]
      const first = detail[0] as { msg?: string };
      if (first?.msg) return first.msg;
    }
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return fallback ?? translate('common.error.generic');
}
