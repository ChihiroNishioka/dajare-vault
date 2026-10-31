import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { createFirestoreStore } from '../src/cloud/firestore-store';
import { registerStoreContract, actor } from './store-contract.cases';

const PROJECT = 'demo-dajare';
let env: RulesTestEnvironment;

function editorAuth(email = 'editor@example.com', verified = true, uid = 'editor-uid') {
  return env.authenticatedContext(uid, { email, email_verified: verified });
}

function body(uid: string, email: string, extra: Record<string, unknown> = {}) {
  return {
    text: '布団がふっとんだ',
    scene: '朝',
    addedAt: '2026-10-02',
    addedAtNote: '',
    reading: '',
    source: '',
    rating: 3,
    favorite: false,
    tags: ['朝'],
    speakers: [],
    memo: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: { uid, email, name: '編集者' },
    updatedBy: { uid, email, name: '編集者' },
    ...extra,
  };
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) return;
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  if (!env) return;
  await env.cleanup();
});

beforeEach(async () => {
  if (!env) return;
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'editors/editor@example.com'), { name: '編集者' });
  });
});

const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!emulatorUp)('firestore rules', () => {
  it('未ログインで read できる', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'dajare/item-1'), {
        text: '公開',
        scene: '不明',
        addedAt: null,
        addedAtNote: '',
        reading: '',
        source: '',
        rating: null,
        favorite: false,
        tags: [],
        speakers: [],
        memo: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: actor,
        updatedBy: actor,
      });
    });
    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, 'dajare/item-1')));
  });

  it('未ログインでは書き込めない', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'dajare/new-1'), body('nobody', 'editor@example.com')));
  });

  it('許可外アカウントでは書き込めない', async () => {
    const db = env
      .authenticatedContext('stranger-uid', { email: 'stranger@example.com', email_verified: true })
      .firestore();
    await assertFails(
      setDoc(doc(db, 'dajare/new-2'), body('stranger-uid', 'stranger@example.com')),
    );
  });

  it('email 未検証では書き込めない', async () => {
    const db = editorAuth('editor@example.com', false).firestore();
    await assertFails(setDoc(doc(db, 'dajare/new-3'), body('editor-uid', 'editor@example.com')));
  });

  it('許可済みアカウントは作成・更新・削除できる', async () => {
    const db = editorAuth().firestore();
    const ref = doc(db, 'dajare/owned');
    await assertSucceeds(setDoc(ref, body('editor-uid', 'editor@example.com')));
    await assertSucceeds(updateDoc(ref, { text: '直した', updatedAt: serverTimestamp() }));
    await assertSucceeds(deleteDoc(ref));
  });

  it('メールアドレスの大文字小文字が違っても許可済みなら作成できる', async () => {
    const db = editorAuth('Editor@Example.com').firestore();
    await assertSucceeds(setDoc(doc(db, 'dajare/cased'), body('editor-uid', 'Editor@Example.com')));
  });

  it('createdBy の偽装は拒否される', async () => {
    const db = editorAuth().firestore();
    await assertFails(setDoc(doc(db, 'dajare/spoof'), body('someone-else', 'editor@example.com')));
  });

  it('createdBy の書き換えは拒否される', async () => {
    const db = editorAuth().firestore();
    const ref = doc(db, 'dajare/keep-author');
    await assertSucceeds(setDoc(ref, body('editor-uid', 'editor@example.com')));
    await assertFails(
      updateDoc(ref, {
        createdBy: { uid: 'editor-uid', email: 'editor@example.com', name: '別人' },
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('余分なキーは拒否される', async () => {
    const db = editorAuth().firestore();
    await assertFails(
      setDoc(doc(db, 'dajare/extra'), body('editor-uid', 'editor@example.com', { note: '余分' })),
    );
  });

  it('長さ超過は拒否される', async () => {
    const db = editorAuth().firestore();
    await assertFails(
      setDoc(
        doc(db, 'dajare/long'),
        body('editor-uid', 'editor@example.com', { text: 'あ'.repeat(201) }),
      ),
    );
    await assertFails(
      setDoc(
        doc(db, 'dajare/too-many-tags'),
        body('editor-uid', 'editor@example.com', {
          tags: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'],
        }),
      ),
    );
  });

  it('editors は本人の get しかできない', async () => {
    const self = editorAuth().firestore();
    await assertSucceeds(getDoc(doc(self, 'editors/editor@example.com')));
    const stranger = env
      .authenticatedContext('stranger-uid', { email: 'stranger@example.com', email_verified: true })
      .firestore();
    await assertFails(getDoc(doc(stranger, 'editors/editor@example.com')));
    await assertFails(getDocs(collection(stranger, 'editors')));
    await assertFails(setDoc(doc(self, 'editors/new@example.com'), { name: '追加' }));
    await assertFails(getDocs(collection(self, 'editors')));
  });

  it('それ以外のパスは拒否される', async () => {
    const db = editorAuth().firestore();
    await assertFails(getDoc(doc(db, 'secrets/one')));
    await assertFails(setDoc(doc(db, 'secrets/one'), { text: 'だめ' }));
  });
});

describe.skipIf(!emulatorUp)('FirestoreStore contract', () => {
  registerStoreContract(async () => {
    const db = editorAuth().firestore() as unknown as Firestore;
    return createFirestoreStore(db, () => actor);
  });
});
