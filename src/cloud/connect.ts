import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { firebaseConfig, isFirebaseConfigured, type FirebaseWebConfig } from '../firebase-config';
import { loadGoogleIdentity, mountGoogleButton } from './google-identity';
import type { Actor } from '../types';
import { createFirestoreStore } from './firestore-store';
import type { DajareStore } from '../store/dajare-store';

export interface CloudSession {
  user: Actor | null;
  emailVerified: boolean;
  isEditor: boolean;
}

export interface CloudConnection {
  store: DajareStore;
  subscribe(listener: (session: CloudSession) => void): () => void;
  /** 予備。クリックの中から、await より前に呼ぶ。 */
  signIn(): Promise<void>;
  /** Google Identity Services のボタンを描く。読み込めなければ onStatus('gsi-load' など)。 */
  renderGoogleButton(container: HTMLElement, onStatus: (code: string) => void): void;
  signOut(): Promise<void>;
}

let opening: Promise<CloudConnection> | null = null;

/** ページを開いたときに呼ぶ。ボタンを押してから SDK を読み始めない。 */
export function connectCloud(
  config: FirebaseWebConfig = firebaseConfig as FirebaseWebConfig,
): Promise<CloudConnection> {
  if (!opening) opening = openCloud(config);
  return opening;
}

async function openCloud(config: FirebaseWebConfig): Promise<CloudConnection> {
  if (!isFirebaseConfigured(config)) {
    throw new Error('Firebase の設定がありません');
  }
  const app = initializeApp(config);
  const auth = getAuth(app);
  const googleButton = loadGoogleIdentity().catch(() => null);
  const db = openFirestore(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  let session: CloudSession = { user: null, emailVerified: false, isEditor: false };
  const listeners = new Set<(next: CloudSession) => void>();
  const emit = (): void => {
    for (const listener of listeners) listener(session);
  };

  const refreshEditor = async (user: User | null): Promise<void> => {
    if (!user || typeof user.email !== 'string' || user.email.length === 0) {
      session = { user: null, emailVerified: false, isEditor: false };
      emit();
      return;
    }
    const email = user.email.toLowerCase();
    let isEditor = false;
    let name = user.displayName?.trim() || 'ログイン中';
    if (user.emailVerified) {
      try {
        const snap = await getDoc(doc(db, 'editors', email));
        const publicName = snap.exists() ? snap.data().publicName : undefined;
        if (typeof publicName === 'string' && publicName.length >= 1 && publicName.length <= 40) {
          isEditor = true;
          name = publicName;
        }
      } catch {
        isEditor = false;
      }
    }
    session = {
      user: { uid: user.uid, name },
      emailVerified: user.emailVerified,
      isEditor,
    };
    emit();
  };

  onAuthStateChanged(auth, (user) => {
    void refreshEditor(user);
  });

  return {
    store: createFirestoreStore(db, () => session.user),
    subscribe(listener) {
      listeners.add(listener);
      listener(session);
      return () => listeners.delete(listener);
    },
    signIn() {
      return signInWithPopup(auth, provider).then(() => undefined);
    },
    renderGoogleButton(container, onStatus) {
      void googleButton.then((id) => {
        if (!id) {
          onStatus('gsi-load');
          return;
        }
        if (!config.googleClientId) {
          onStatus('gsi-origin');
          return;
        }
        try {
          mountGoogleButton(
            id,
            container,
            config.googleClientId,
            (idToken) => {
              void signInWithCredential(auth, GoogleAuthProvider.credential(idToken)).catch(
                (error: unknown) => {
                  const code =
                    error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
                  onStatus(code || 'auth/unknown');
                },
              );
            },
            () => onStatus('gsi-closed'),
          );
        } catch {
          onStatus('gsi-origin');
        }
      });
    },
    async signOut() {
      await firebaseSignOut(auth);
    },
  };
}

function openFirestore(app: FirebaseApp): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    return getFirestore(app);
  }
}
