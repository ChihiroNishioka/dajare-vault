import { firebaseConfig, isFirebaseConfigured, type FirebaseWebConfig } from '../firebase-config';
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
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

/** 設定があるときだけ呼ぶ。Firebase SDK はこの関数の中で初めて読み込む。 */
export async function connectCloud(
  config: FirebaseWebConfig = firebaseConfig as FirebaseWebConfig,
): Promise<CloudConnection> {
  if (!isFirebaseConfigured(config)) {
    throw new Error('Firebase の設定がありません');
  }
  const [{ initializeApp }, authMod, firestoreMod] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ]);
  const app = initializeApp(config);
  const auth = authMod.getAuth(app);
  const db = firestoreMod.getFirestore(app);
  const provider = new authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  let session: CloudSession = { user: null, emailVerified: false, isEditor: false };
  const listeners = new Set<(next: CloudSession) => void>();
  const emit = (): void => {
    for (const listener of listeners) listener(session);
  };

  const refreshEditor = async (user: import('firebase/auth').User | null): Promise<void> => {
    if (!user?.email) {
      session = { user: null, emailVerified: false, isEditor: false };
      emit();
      return;
    }
    const actor: Actor = {
      uid: user.uid,
      email: user.email,
      name: user.displayName || user.email,
    };
    let isEditor = false;
    if (user.emailVerified) {
      try {
        const snap = await firestoreMod.getDoc(
          firestoreMod.doc(db, 'editors', user.email.toLowerCase()),
        );
        isEditor = snap.exists();
      } catch {
        isEditor = false;
      }
    }
    session = { user: actor, emailVerified: user.emailVerified, isEditor };
    emit();
  };

  authMod.onAuthStateChanged(auth, (user) => {
    void refreshEditor(user);
  });
  try {
    await authMod.getRedirectResult(auth);
  } catch {
    // ログインしていない、または戻りの検証に失敗した。画面は閲覧のまま。
  }

  const actor = (): Actor | null => session.user;

  return {
    store: createFirestoreStore(db, actor),
    subscribe(listener) {
      listeners.add(listener);
      listener(session);
      return () => listeners.delete(listener);
    },
    async signIn() {
      try {
        await authMod.signInWithPopup(auth, provider);
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        const fallback =
          code === 'auth/popup-blocked' ||
          code === 'auth/cancelled-popup-request' ||
          code === 'auth/operation-not-supported-in-this-environment';
        if (!fallback) throw error;
        await authMod.signInWithRedirect(auth, provider);
      }
    },
    async signOut() {
      await authMod.signOut(auth);
    },
  };
}
