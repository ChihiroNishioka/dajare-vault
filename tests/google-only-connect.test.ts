import { afterEach, expect, it, vi } from 'vitest';
import type { FirebaseWebConfig } from '../src/firebase-config';

const authMock = vi.hoisted(() => {
  class GoogleAuthProvider {
    static credential = vi.fn((token: string) => ({ token }));
    setCustomParameters(): void {}
  }
  return {
    GoogleAuthProvider,
    getAuth: vi.fn(() => ({})),
    onAuthStateChanged: vi.fn(() => () => undefined),
    signInWithCredential: vi.fn(() => Promise.resolve()),
    signInWithPopup: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
}));

vi.mock('firebase/auth', () => authMock);

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(() => Promise.resolve({ exists: () => false })),
  getFirestore: vi.fn(() => ({})),
  initializeFirestore: vi.fn(() => ({})),
  persistentLocalCache: vi.fn(() => ({})),
  persistentMultipleTabManager: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  onSnapshot: vi.fn(),
  deleteDoc: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}));

const originalError = console.error;

function dummyConfig(): FirebaseWebConfig {
  const apiKey = ['api', 'Key'].join('');
  return {
    [apiKey]: 'demo',
    authDomain: 'demo.firebaseapp.com',
    projectId: 'demo-dajare',
    storageBucket: 'demo.appspot.com',
    messagingSenderId: '0',
    appId: 'demo-app',
    googleClientId: 'demo.apps.googleusercontent.com',
  } as unknown as FirebaseWebConfig;
}

afterEach(() => {
  console.error = originalError;
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
  vi.resetModules();
  vi.clearAllMocks();
});

it('signs in from the Google button credential and has no popup sign-in', async () => {
  vi.resetModules();
  const calls: string[] = [];
  let callback: ((response: { credential?: string }) => void) | undefined;
  Object.assign(globalThis, {
    window: {
      google: {
        accounts: {
          id: {
            initialize(config: Record<string, unknown>) {
              calls.push('initialize');
              callback = config.callback as (response: { credential?: string }) => void;
            },
            renderButton() {
              calls.push('renderButton');
            },
          },
        },
      },
    },
    document: {
      createElement: () => ({}),
      head: { append() {} },
    },
  });
  const { connectCloud } = await import('../src/cloud/connect');
  const { signInWithCredential, signInWithPopup } = await import('firebase/auth');
  const host = { childElementCount: 0 } as unknown as HTMLElement;
  const connection = await connectCloud(dummyConfig());
  connection.renderGoogleButton(host, () => undefined);
  await Promise.resolve();
  expect(calls).toEqual(['initialize', 'renderButton']);
  callback?.({ credential: 'id-token' });
  expect(signInWithCredential).toHaveBeenCalledTimes(1);
  expect(signInWithPopup).toHaveBeenCalledTimes(0);
  expect('signIn' in connection).toBe(false);
});

it('tells the button once when the Google script fails to load', async () => {
  vi.resetModules();
  const statuses: string[] = [];
  Object.assign(globalThis, {
    window: {},
    document: {
      createElement() {
        return {
          onload: null as null | (() => void),
          onerror: null as null | (() => void),
        };
      },
      head: {
        append(script: { onerror: null | (() => void) }) {
          script.onerror?.();
        },
      },
    },
  });
  const { connectCloud } = await import('../src/cloud/connect');
  const host = { childElementCount: 0 } as unknown as HTMLElement;
  const connection = await connectCloud(dummyConfig());
  connection.renderGoogleButton(host, (code) => {
    statuses.push(code);
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(statuses).toEqual(['gsi-load']);
});

it('reports a rejected credential on the status callback', async () => {
  vi.resetModules();
  authMock.signInWithCredential.mockRejectedValueOnce({ code: 'auth/unknown' });
  const calls: string[] = [];
  let callback: ((response: { credential?: string }) => void) | undefined;
  const statuses: string[] = [];
  Object.assign(globalThis, {
    window: {
      google: {
        accounts: {
          id: {
            initialize(config: Record<string, unknown>) {
              calls.push('initialize');
              callback = config.callback as (response: { credential?: string }) => void;
            },
            renderButton() {
              calls.push('renderButton');
            },
          },
        },
      },
    },
    document: {
      createElement: () => ({}),
      head: { append() {} },
    },
  });
  const { connectCloud } = await import('../src/cloud/connect');
  const host = { childElementCount: 0 } as unknown as HTMLElement;
  const connection = await connectCloud(dummyConfig());
  connection.renderGoogleButton(host, (code) => {
    statuses.push(code);
  });
  await Promise.resolve();
  expect(calls).toEqual(['initialize', 'renderButton']);
  callback?.({ credential: 'id-token' });
  await Promise.resolve();
  await Promise.resolve();
  expect(statuses).toEqual(['auth/unknown']);
});
