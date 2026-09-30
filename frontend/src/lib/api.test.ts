// What a failed request says to the person who made it.
//
// The server names the failure and this writes the sentence, which is the
// arrangement every other sentence in the product already had. Before it, a
// manager reading the app in Spanish who mistyped their password was told
// "Invalid credentials" -- and there was nothing the client could have done
// about it, because prose was all it received.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import {
  api,
  clearSessionEnded,
  endsASession,
  errorCode,
  getErrorMessage,
  markSessionEnded,
  onAppNotEnabled,
  SESSION_ENDED_KEY,
  sessionEnded,
  TOKEN_STORAGE_KEY,
} from './api';
import { getLanguage, setLanguage, translate, type Language } from './i18n/core';

function inLanguage<T>(lang: Language, read: () => T): T {
  const before = getLanguage();
  try {
    setLanguage(lang);
    return read();
  } finally {
    setLanguage(before);
  }
}

/** An axios failure carrying whatever the server put in `detail`. */
function failure(detail: unknown, status = 400): AxiosError {
  const error = new AxiosError('Request failed');
  error.response = {
    data: { detail },
    status,
    statusText: '',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  return error;
}

describe('an error the server named', () => {
  it('is read in the language the manager is reading', () => {
    const wrong = failure({ code: 'invalid_credentials', message: 'Invalid credentials' }, 401);
    expect(inLanguage('en', () => getErrorMessage(wrong))).toBe(
      'That email and password do not match an account.',
    );
    expect(inLanguage('es', () => getErrorMessage(wrong))).toBe(
      'Ese correo y esa contraseña no coinciden con ninguna cuenta.',
    );
  });

  it('puts the server’s own figures into the sentence', () => {
    const unknown = failure(
      {
        code: 'unknown_jurisdiction',
        message: 'No labour rules for FR. Known jurisdictions: ES',
        params: { jurisdiction: 'FR', known: 'ES' },
      },
      422,
    );
    expect(inLanguage('es', () => getErrorMessage(unknown))).toBe(
      'No tenemos normas laborales de FR. Las que tenemos: ES.',
    );
  });

  it('keeps the raw exception off the screen', () => {
    // The server still carries it in `message`, for a log and a network tab.
    // What the manager gets is a sentence.
    const failed = failure({
      code: 'plan_failed',
      message: "Could not plan the calendar: BadRequestError(400, {'type': 'error'})",
    });
    const shown = inLanguage('es', () => getErrorMessage(failed));
    expect(shown).toBe('No se ha podido planificar el calendario. Inténtalo dentro de un momento.');
    expect(shown).not.toContain('BadRequestError');
  });

  it('shows the English it was sent when the code is newer than this bundle', () => {
    const future = failure({ code: 'invented_next_year', message: 'Something new went wrong' });
    expect(inLanguage('es', () => getErrorMessage(future))).toBe('Something new went wrong');
  });
});

describe('an error the server did not name', () => {
  it('still shows a plain string, the way every error used to', () => {
    // A route that has not been given a code yet. The two shapes coexist on
    // purpose, so adding codes did not have to be one commit.
    expect(inLanguage('es', () => getErrorMessage(failure('Something went wrong')))).toBe(
      'Something went wrong',
    );
  });

  it('shows FastAPI’s own validation error rather than swallowing it', () => {
    // No manager should ever see one; seeing it is the bug report.
    const invalid = failure([{ loc: ['body', 'x'], msg: 'field required', type: 'missing' }], 422);
    expect(inLanguage('es', () => getErrorMessage(invalid))).toBe('field required');
  });

  it('falls back to a sentence of its own when there is nothing at all', () => {
    // Not an axios error, not an Error: something threw a bare object. There
    // is nothing to report but there is still somebody waiting to be told.
    // Both sides read in the SAME language. `translate` outside the wrapper
    // uses whatever language the machine happens to default to, so this passed
    // on a laptop set to Spanish and failed everywhere else -- which nobody
    // found out until CI started running these tests.
    const [said, generic] = inLanguage('es', () => [
      getErrorMessage({}),
      translate('common.error.generic'),
    ]);
    expect(said).toBe(generic);
    expect(inLanguage('en', () => getErrorMessage({}, 'Could not save'))).toBe(
      'Could not save',
    );
  });
});

describe('the code of a failure', () => {
  it('is the one the server named', () => {
    expect(errorCode(failure({ code: 'app_not_enabled', message: 'x' }, 403))).toBe('app_not_enabled');
  });

  it('is nothing when the server did not name one', () => {
    expect(errorCode(failure('Not allowed', 403))).toBeUndefined();
    expect(errorCode(failure([{ msg: 'field required' }], 422))).toBeUndefined();
    expect(errorCode(new Error('boom'))).toBeUndefined();
  });
});

describe('an app switched off while its page is open', () => {
  // Through the real instance and its interceptors, with an adapter that
  // answers the way the server does -- the listener is how the workspace
  // learns its list of apps is stale. The request side reads the token from
  // localStorage, which node does not have: without one the request fails
  // before it is sent, and no answer of the server's is ever read.
  beforeAll(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, removeItem: () => undefined });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  async function answer(detail: unknown, status: number) {
    await api
      .get('/anything', { adapter: () => Promise.reject(failure(detail, status)) })
      .catch(() => undefined);
  }

  it('tells whoever holds the list of apps', async () => {
    let told = 0;
    const stop = onAppNotEnabled(() => told++);
    try {
      await answer({ code: 'app_not_enabled', message: 'x', params: { app: 'inventory' } }, 403);
      expect(told).toBe(1);
    } finally {
      stop();
    }
  });

  it('says nothing for any other refusal, or once nobody is listening', async () => {
    let told = 0;
    const stop = onAppNotEnabled(() => told++);
    await answer({ code: 'manager_role_required', message: 'x' }, 403);
    stop();
    await answer({ code: 'app_not_enabled', message: 'x' }, 403);
    expect(told).toBe(0);
  });
});

/** A Storage kept in a Map, for node, which has none. */
function memoryStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe('a session the server closed', () => {
  it('is marked, read without being taken away, and cleared', () => {
    const storage = memoryStorage();
    expect(sessionEnded(storage)).toBe(false);
    markSessionEnded(storage);
    expect(sessionEnded(storage)).toBe(true);
    expect(sessionEnded(storage)).toBe(true);
    clearSessionEnded(storage);
    expect(sessionEnded(storage)).toBe(false);
  });

  it('says nothing, and breaks nothing, without storage or with it blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => markSessionEnded(blocked)).not.toThrow();
    expect(sessionEnded(blocked)).toBe(false);
    expect(() => clearSessionEnded(blocked)).not.toThrow();
    expect(sessionEnded(null)).toBe(false);
  });

  it('is only a 401 that met an open session, away from the sign-in', () => {
    expect(endsASession(true, '/inventory')).toBe(true);
    // A wrong password: nobody was signed in to be signed out.
    expect(endsASession(false, '/login')).toBe(false);
    expect(endsASession(true, '/login')).toBe(false);
    expect(endsASession(true, '/signup')).toBe(false);
    expect(endsASession(false, '/store/menu')).toBe(false);
  });

  describe('through the real interceptor', () => {
    let local: ReturnType<typeof memoryStorage>;
    let tab: ReturnType<typeof memoryStorage>;
    let sentTo: string[];

    function stub(path: string, token: string | null) {
      local = memoryStorage(token ? { [TOKEN_STORAGE_KEY]: token } : {});
      tab = memoryStorage();
      sentTo = [];
      vi.stubGlobal('localStorage', local);
      vi.stubGlobal('sessionStorage', tab);
      vi.stubGlobal('window', { location: { pathname: path, assign: (to: string) => void sentTo.push(to) } });
    }

    afterAll(() => {
      vi.unstubAllGlobals();
    });

    async function refused(status: number) {
      await api
        .get('/anything', { adapter: () => Promise.reject(failure({ code: 'session_invalid', message: 'x' }, status)) })
        .catch(() => undefined);
    }

    it('marks the tab when a page’s request finds the session gone, and goes to the sign-in', async () => {
      stub('/inventory', 'a-token');
      await refused(401);
      expect(local.map.has(TOKEN_STORAGE_KEY)).toBe(false);
      expect(tab.map.get(SESSION_ENDED_KEY)).toBe('1');
      expect(sentTo).toEqual(['/login']);
    });

    it('leaves no mark for a wrong password at the sign-in', async () => {
      stub('/login', null);
      await refused(401);
      expect(tab.map.has(SESSION_ENDED_KEY)).toBe(false);
      expect(sentTo).toEqual([]);
    });

    it('leaves no mark for any other refusal', async () => {
      stub('/inventory', 'a-token');
      await refused(403);
      expect(tab.map.has(SESSION_ENDED_KEY)).toBe(false);
      expect(local.map.has(TOKEN_STORAGE_KEY)).toBe(true);
    });
  });
});
