import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { commitCloud } from '../src/cloud/commit-cloud';
import { createFirestoreStore } from '../src/cloud/firestore-store';
import { SEED_IDS } from '../src/data/seed-ids';
import seedFile from '../src/data/seed.json';
import { emptyDecisions, planImport, prepareImportCommit } from '../src/domain/transfer';
import { seedId } from '../src/domain/ids';
import type { Dajare } from '../src/types';
import { actor, registerStoreContract, sampleDraft } from './store-contract.cases';

const PROJECT = 'demo-dajare';
let env: RulesTestEnvironment;

function editorAuth(
  email = 'editor@example.com',
  verified = true,
  uid = 'editor-uid',
  provider: 'google.com' | 'password' = 'google.com',
) {
  return env.authenticatedContext(uid, {
    email,
    email_verified: verified,
    firebase: { sign_in_provider: provider },
  });
}

function entry(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
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
    createdBy: { uid: 'editor-uid', name: '編集者' },
    updatedBy: { uid: 'editor-uid', name: '編集者' },
    ...extra,
  };
}

function pun(id: string, text: string): Dajare {
  return { ...sampleDraft(text), id, updatedAt: '2026-04-01T00:00:00Z' };
}

async function storedText(id: string): Promise<string> {
  let text = '';
  await env.withSecurityRulesDisabled(async (context) => {
    const snap = await getDoc(doc(context.firestore(), `dajare/${id}`));
    text = snap.exists() ? String(snap.data().text ?? '') : '';
  });
  return text;
}

async function waitFor(pred: () => boolean): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > 5000) throw new Error('timed out waiting for the store');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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
    await setDoc(doc(context.firestore(), 'editors/editor@example.com'), { publicName: '編集者' });
  });
});

const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!emulatorUp)('firestore rules', () => {
  it('未ログインで read できる', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `dajare/${seedId(1)}`), {
        ...entry(seedId(1)),
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: actor,
        updatedBy: actor,
      });
    });
    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, `dajare/${seedId(1)}`)));
  });

  it('未ログインでは書き込めない', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, `dajare/${seedId(2)}`), entry(seedId(2))));
  });

  it('許可外アカウントでは書き込めない', async () => {
    const db = env
      .authenticatedContext('stranger-uid', {
        email: 'stranger@example.com',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();
    await assertFails(
      setDoc(
        doc(db, `dajare/${seedId(3)}`),
        entry(seedId(3), {
          createdBy: { uid: 'stranger-uid', name: '編集者' },
          updatedBy: { uid: 'stranger-uid', name: '編集者' },
        }),
      ),
    );
  });

  it('email 未検証では書き込めない', async () => {
    const db = editorAuth('editor@example.com', false).firestore();
    await assertFails(setDoc(doc(db, `dajare/${seedId(4)}`), entry(seedId(4))));
  });

  it('Google 以外のログインでは書き込めない', async () => {
    const db = editorAuth('editor@example.com', true, 'editor-uid', 'password').firestore();
    await assertFails(setDoc(doc(db, `dajare/${seedId(5)}`), entry(seedId(5))));
  });

  it('許可済みアカウントは作成・更新・削除できる', async () => {
    const db = editorAuth().firestore();
    const id = seedId(6);
    const ref = doc(db, `dajare/${id}`);
    await assertSucceeds(setDoc(ref, entry(id)));
    await assertSucceeds(
      updateDoc(ref, {
        text: '直した',
        updatedAt: serverTimestamp(),
        updatedBy: { uid: 'editor-uid', name: '編集者' },
      }),
    );
    await assertSucceeds(deleteDoc(ref));
  });

  it('リストの各要素が上限内なら作成できる', async () => {
    const db = editorAuth().firestore();
    const id = seedId(7);
    await assertSucceeds(
      setDoc(
        doc(db, `dajare/${id}`),
        entry(id, {
          tags: Array.from({ length: 10 }, () => 'あ'.repeat(20)),
          speakers: Array.from({ length: 10 }, () => 'い'.repeat(30)),
        }),
      ),
    );
  });

  it('メールアドレスの大文字小文字が違っても許可済みなら作成できる', async () => {
    const db = editorAuth('Editor@Example.com').firestore();
    const id = seedId(8);
    await assertSucceeds(setDoc(doc(db, `dajare/${id}`), entry(id)));
  });

  it('createdBy の偽装は拒否される', async () => {
    const db = editorAuth().firestore();
    await assertFails(
      setDoc(
        doc(db, `dajare/${seedId(9)}`),
        entry(seedId(9), {
          createdBy: { uid: 'someone-else', name: '編集者' },
          updatedBy: { uid: 'someone-else', name: '編集者' },
        }),
      ),
    );
  });

  it('メールアドレスを文書に入れる偽装は拒否される', async () => {
    const db = editorAuth().firestore();
    await assertFails(
      setDoc(
        doc(db, `dajare/${seedId(10)}`),
        entry(seedId(10), {
          createdBy: { uid: 'editor-uid', name: '編集者', email: 'editor@example.com' },
          updatedBy: { uid: 'editor-uid', name: '編集者', email: 'editor@example.com' },
        }),
      ),
    );
  });

  it('日時の偽装は拒否される', async () => {
    const db = editorAuth().firestore();
    const forged = new Date('2020-01-01T00:00:00Z');
    await assertFails(
      setDoc(
        doc(db, `dajare/${seedId(11)}`),
        entry(seedId(11), { createdAt: forged, updatedAt: forged }),
      ),
    );
    const id = seedId(12);
    const ref = doc(db, `dajare/${id}`);
    await assertSucceeds(setDoc(ref, entry(id)));
    await assertFails(
      updateDoc(ref, {
        text: '直した',
        updatedAt: forged,
        updatedBy: { uid: 'editor-uid', name: '編集者' },
      }),
    );
  });

  it('publicName と違う名前は拒否される', async () => {
    const db = editorAuth().firestore();
    await assertFails(
      setDoc(
        doc(db, `dajare/${seedId(13)}`),
        entry(seedId(13), {
          createdBy: { uid: 'editor-uid', name: '別人' },
          updatedBy: { uid: 'editor-uid', name: '別人' },
        }),
      ),
    );
    const id = seedId(14);
    const ref = doc(db, `dajare/${id}`);
    await assertSucceeds(setDoc(ref, entry(id)));
    await assertFails(
      updateDoc(ref, {
        updatedAt: serverTimestamp(),
        updatedBy: { uid: 'editor-uid', name: '別人' },
      }),
    );
  });

  it('createdBy と createdAt の書き換えは拒否される', async () => {
    const db = editorAuth().firestore();
    const id = seedId(15);
    const ref = doc(db, `dajare/${id}`);
    await assertSucceeds(setDoc(ref, entry(id)));
    await assertFails(
      updateDoc(ref, {
        createdBy: { uid: 'other-uid', name: '編集者' },
        updatedAt: serverTimestamp(),
        updatedBy: { uid: 'editor-uid', name: '編集者' },
      }),
    );
    await assertFails(
      updateDoc(ref, {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedBy: { uid: 'editor-uid', name: '編集者' },
      }),
    );
  });

  it('余分なキーや足りない項目は拒否される', async () => {
    const db = editorAuth().firestore();
    await assertFails(setDoc(doc(db, `dajare/${seedId(16)}`), entry(seedId(16), { note: '余分' })));
    const missing = entry(seedId(17));
    delete (missing as { memo?: string }).memo;
    await assertFails(setDoc(doc(db, `dajare/${seedId(17)}`), missing));
  });

  it('長さ超過とリスト要素の型違いは拒否される', async () => {
    const db = editorAuth().firestore();
    await assertFails(
      setDoc(doc(db, `dajare/${seedId(18)}`), entry(seedId(18), { text: 'あ'.repeat(201) })),
    );
    await assertFails(
      setDoc(
        doc(db, `dajare/${seedId(19)}`),
        entry(seedId(19), {
          tags: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'],
        }),
      ),
    );
    await assertFails(
      setDoc(doc(db, `dajare/${seedId(20)}`), entry(seedId(20), { tags: ['朝', 1] })),
    );
    await assertFails(setDoc(doc(db, `dajare/${seedId(21)}`), entry(seedId(21), { tags: [''] })));
    await assertFails(
      setDoc(doc(db, `dajare/${seedId(23)}`), entry(seedId(23), { tags: ['あ'.repeat(21)] })),
    );
    await assertFails(
      setDoc(doc(db, `dajare/${seedId(24)}`), entry(seedId(24), { tags: ['朝\n夕'] })),
    );
  });

  it('editors から外すと書けなくなる', async () => {
    const db = editorAuth().firestore();
    const id = seedId(22);
    await assertSucceeds(setDoc(doc(db, `dajare/${id}`), entry(id)));
    await env.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'editors/editor@example.com'));
    });
    await assertFails(
      updateDoc(doc(db, `dajare/${id}`), {
        text: 'もう書けない',
        updatedAt: serverTimestamp(),
        updatedBy: { uid: 'editor-uid', name: '編集者' },
      }),
    );
  });

  it('editors は本人の get しかできない', async () => {
    const self = editorAuth().firestore();
    await assertSucceeds(getDoc(doc(self, 'editors/editor@example.com')));
    const stranger = env
      .authenticatedContext('stranger-uid', {
        email: 'stranger@example.com',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();
    await assertFails(getDoc(doc(stranger, 'editors/editor@example.com')));
    await assertFails(getDocs(collection(stranger, 'editors')));
    await assertFails(setDoc(doc(self, 'editors/new@example.com'), { publicName: '追加' }));
    await assertFails(getDocs(collection(self, 'editors')));
  });

  it('移行の印は一度だけ作れて、消せない', async () => {
    const db = editorAuth().firestore();
    const ref = doc(db, 'meta/seedMigration');
    await assertFails(setDoc(ref, { doneAt: new Date('2020-01-01T00:00:00Z') }));
    await assertFails(setDoc(ref, {}));
    await assertSucceeds(setDoc(ref, { doneAt: serverTimestamp() }));
    await assertSucceeds(
      getDoc(doc(env.unauthenticatedContext().firestore(), 'meta/seedMigration')),
    );
    await assertFails(setDoc(ref, { doneAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { doneAt: serverTimestamp() }));
    await assertFails(deleteDoc(ref));
    await assertFails(setDoc(doc(db, 'meta/other'), { doneAt: serverTimestamp() }));
  });

  async function renamePublicName(publicName: string): Promise<void> {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'editors/editor@example.com'), { publicName });
    });
  }

  it('自分の表示名だけを、いまの publicName にそろえられる', async () => {
    const db = editorAuth().firestore();
    const id = seedId(210);
    const ref = doc(db, `dajare/${id}`);
    await assertSucceeds(setDoc(ref, entry(id)));
    const before = await getDoc(ref);
    await renamePublicName('まひろ');
    await assertSucceeds(
      updateDoc(ref, {
        createdBy: { uid: 'editor-uid', name: 'まひろ' },
        updatedBy: { uid: 'editor-uid', name: 'まひろ' },
      }),
    );
    const after = await getDoc(ref);
    expect(after.data()?.text).toBe('布団がふっとんだ');
    expect(after.data()?.scene).toBe(before.data()?.scene);
    expect(after.data()?.memo).toBe(before.data()?.memo);
    expect(after.data()?.createdAt.isEqual(before.data()?.createdAt)).toBe(true);
    expect(after.data()?.updatedAt.isEqual(before.data()?.updatedAt)).toBe(true);
    expect(after.data()?.createdBy).toEqual({ uid: 'editor-uid', name: 'まひろ' });
    expect(after.data()?.updatedBy).toEqual({ uid: 'editor-uid', name: 'まひろ' });
  });

  it('表示名のそろえは、変わった側だけでも許される', async () => {
    const db = editorAuth().firestore();
    const id = seedId(211);
    const ref = doc(db, `dajare/${id}`);
    await assertSucceeds(setDoc(ref, entry(id)));
    await renamePublicName('まひろ');
    await assertSucceeds(updateDoc(ref, { createdBy: { uid: 'editor-uid', name: 'まひろ' } }));
    const after = await getDoc(ref);
    expect(after.data()?.createdBy).toEqual({ uid: 'editor-uid', name: 'まひろ' });
    expect(after.data()?.updatedBy).toEqual({ uid: 'editor-uid', name: '編集者' });
    expect(after.data()?.text).toBe('布団がふっとんだ');
  });

  it('他人の書いた人は、表示名をそろえる対象にできない', async () => {
    const id = seedId(212);
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `dajare/${id}`), {
        ...entry(id),
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: { uid: 'other-uid', name: 'ほかの人' },
        updatedBy: { uid: 'other-uid', name: 'ほかの人' },
      });
    });
    const db = editorAuth().firestore();
    await renamePublicName('まひろ');
    await assertFails(
      updateDoc(doc(db, `dajare/${id}`), {
        createdBy: { uid: 'other-uid', name: 'まひろ' },
      }),
    );
    await assertFails(
      updateDoc(doc(db, `dajare/${id}`), {
        createdBy: { uid: 'editor-uid', name: 'まひろ' },
      }),
    );
  });

  it('表示名が publicName と違うそろえは拒否される', async () => {
    const db = editorAuth().firestore();
    const id = seedId(213);
    const ref = doc(db, `dajare/${id}`);
    await assertSucceeds(setDoc(ref, entry(id)));
    await renamePublicName('まひろ');
    await assertFails(
      updateDoc(ref, {
        createdBy: { uid: 'editor-uid', name: '別人' },
        updatedBy: { uid: 'editor-uid', name: '別人' },
      }),
    );
  });

  it('表示名をそろえるときに uid は変えられない', async () => {
    const db = editorAuth().firestore();
    const id = seedId(214);
    const ref = doc(db, `dajare/${id}`);
    await assertSucceeds(setDoc(ref, entry(id)));
    await renamePublicName('まひろ');
    await assertFails(
      updateDoc(ref, {
        createdBy: { uid: 'editor-uid-2', name: 'まひろ' },
      }),
    );
  });

  it('表示名と一緒に本文や日時は変えられない', async () => {
    const db = editorAuth().firestore();
    const id = seedId(215);
    const ref = doc(db, `dajare/${id}`);
    await assertSucceeds(setDoc(ref, entry(id)));
    await renamePublicName('まひろ');
    await assertFails(
      updateDoc(ref, {
        text: '書き換えた',
        createdBy: { uid: 'editor-uid', name: 'まひろ' },
        updatedBy: { uid: 'editor-uid', name: 'まひろ' },
      }),
    );
    await assertFails(
      updateDoc(ref, {
        updatedAt: serverTimestamp(),
        createdBy: { uid: 'editor-uid', name: 'まひろ' },
      }),
    );
    const after = await getDoc(ref);
    expect(after.data()?.text).toBe('布団がふっとんだ');
    expect(after.data()?.createdBy).toEqual({ uid: 'editor-uid', name: '編集者' });
  });

  it('編集者でない人は表示名をそろえられない', async () => {
    const id = seedId(216);
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `dajare/${id}`), {
        ...entry(id),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    const stranger = env
      .authenticatedContext('stranger-uid', {
        email: 'stranger@example.com',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();
    await assertFails(
      updateDoc(doc(stranger, `dajare/${id}`), {
        createdBy: { uid: 'editor-uid', name: 'まひろ' },
      }),
    );
  });

  it('未ログインでは表示名をそろえられない', async () => {
    const id = seedId(217);
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `dajare/${id}`), {
        ...entry(id),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    const db = env.unauthenticatedContext().firestore();
    await assertFails(
      updateDoc(doc(db, `dajare/${id}`), {
        createdBy: { uid: 'editor-uid', name: 'まひろ' },
      }),
    );
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

describe.skipIf(!emulatorUp)('seed migration', () => {
  function open() {
    return createFirestoreStore(editorAuth().firestore() as unknown as Firestore, () => actor);
  }

  it('二度目は上書きせず、消した初期データは戻さない', async () => {
    const store = open();
    const first = pun(seedId(40), '一度目');
    const second = pun(seedId(41), '二度目');
    await waitFor(() => store.migrationPending());
    const imported = await store.migrateSeed([first, second], actor);
    expect(imported).toEqual({ added: 2, skipped: 0 });
    await waitFor(() => !store.migrationPending());
    const again = await store.migrateSeed(
      [{ ...first, text: '上書きしてはいけない' }, second],
      actor,
    );
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(2);
    expect(await storedText(first.id)).toBe('一度目');
    const removed = await store.remove(first.id);
    expect(removed.ok).toBe(true);
    await waitFor(() => store.getItems().every((item) => item.id !== first.id));
    const third = await store.migrateSeed([first, second], actor);
    expect(third.added).toBe(0);
    expect(await storedText(first.id)).toBe('');
    expect(await storedText(second.id)).toBe('二度目');
  });

  it('途中まで入っている移行を、ある紙を上書きせずに再開できる', async () => {
    const store = open();
    const kept = pun(seedId(42), '残す');
    const added = pun(seedId(43), '足す');
    await waitFor(() => store.migrationPending());
    const created = await store.create(
      {
        text: kept.text,
        scene: kept.scene,
        addedAt: kept.addedAt,
        addedAtNote: kept.addedAtNote,
        reading: kept.reading,
        source: kept.source,
        rating: kept.rating,
        favorite: kept.favorite,
        tags: kept.tags,
        speakers: kept.speakers,
        memo: kept.memo,
      },
      actor,
      kept.id,
    );
    expect(created.ok).toBe(true);
    expect(store.migrationPending()).toBe(true);
    const resumed = await store.migrateSeed(
      [{ ...kept, text: '上書きしてはいけない' }, added],
      actor,
    );
    expect(resumed.added).toBe(1);
    expect(resumed.skipped).toBe(1);
    expect(resumed.error).toBeUndefined();
    expect(await storedText(kept.id)).toBe('残す');
    expect(await storedText(added.id)).toBe('足す');
    await waitFor(() => !store.migrationPending());
  });

  it('印のあと、端末の送信で消した見本は戻らない', async () => {
    const store = open();
    const seedItems = (seedFile as { items: Dajare[] }).items.slice(0, 4);
    const removed = seedItems[0];
    const own = pun(seedId(500), 'この端末だけ');
    if (!removed) throw new Error('missing seed');
    await waitFor(() => store.migrationPending());
    const migrated = await store.migrateSeed(seedItems, actor);
    expect(migrated.added).toBe(seedItems.length);
    expect(migrated.error).toBeUndefined();
    await waitFor(() => !store.migrationPending());
    expect((await store.remove(removed.id)).ok).toBe(true);
    await waitFor(() => store.getItems().every((item) => item.id !== removed.id));
    const sent = await store.bulkImport([...seedItems, own], actor);
    expect(sent.error).toBeUndefined();
    expect(sent.added).toBe(1);
    expect(await storedText(removed.id)).toBe('');
    expect(await storedText(own.id)).toBe('この端末だけ');
    for (const kept of seedItems.slice(1)) {
      expect(await storedText(kept.id)).toBe(kept.text);
    }
  });

  it('印のあと、古い書き出しを読み込んでも消した見本は戻らない', async () => {
    const store = open();
    const seedItems = (seedFile as { items: Dajare[] }).items.slice(0, 3);
    const removed = seedItems[0];
    const extra = pun(seedId(501), '書き出しの新しい紙');
    if (!removed) throw new Error('missing seed');
    await waitFor(() => store.migrationPending());
    const migrated = await store.migrateSeed(seedItems, actor);
    expect(migrated.error).toBeUndefined();
    expect(migrated.added).toBe(seedItems.length);
    await waitFor(() => store.migrationDone());
    expect((await store.remove(removed.id)).ok).toBe(true);
    await waitFor(() => store.getItems().every((item) => item.id !== removed.id));
    const incoming = [...seedItems, extra];
    const shown = planImport(store.getItems(), incoming);
    const prepared = prepareImportCommit(
      store.getItems(),
      incoming,
      shown,
      emptyDecisions(),
      SEED_IDS,
    );
    expect(prepared.stale).toBe(false);
    if (prepared.stale) return;
    expect(prepared.seedSkippedIds).toContain(removed.id);
    expect(prepared.createIds).not.toContain(removed.id);
    const imported = await commitCloud(
      store,
      incoming,
      { createIds: [removed.id, extra.id], updateIds: [], seedSkippedIds: [] },
      actor,
    );
    expect(imported.error).toBeUndefined();
    expect(imported.seedSkipped).toBe(1);
    expect(imported.added).toBe(1);
    expect(await storedText(removed.id)).toBe('');
    expect(await storedText(extra.id)).toBe('書き出しの新しい紙');
  });

  it('確認のあとで直された紙は上書きしない', async () => {
    const store = open();
    const created = await store.create(sampleDraft('元の本文'), actor);
    expect(created.ok).toBe(true);
    await waitFor(() =>
      store.getItems().some((item) => item.text === '元の本文' && item.updatedAt !== ''),
    );
    const item = store.getItems().find((row) => row.text === '元の本文');
    if (!item) throw new Error('missing item');
    const expected = item.updatedAt;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const edited = await store.update(item.id, sampleDraft('誰かが直した'), actor);
    expect(edited.ok).toBe(true);
    await waitFor(() =>
      store.getItems().some((row) => row.id === item.id && row.updatedAt !== expected),
    );
    const skipped = await store.update(item.id, sampleDraft('上書き'), actor, {
      expectedUpdatedAt: expected,
    });
    expect(skipped.ok).toBe(true);
    expect(skipped.skipped).toBe('changed');
    expect(await storedText(item.id)).toBe('誰かが直した');
  });

  it('ありえない日付は共有DBに書かない', async () => {
    const store = open();
    const id = seedId(80);
    const result = await store.create({ ...sampleDraft(), addedAt: '2026-02-31' }, actor, id);
    expect(result.ok).toBe(false);
    expect(await storedText(id)).toBe('');
  });

  it('二人同時に流しても同じ紙は一つだけになる', async () => {
    const left = open();
    const right = open();
    const first = pun(seedId(44), '同時A');
    const second = pun(seedId(45), '同時B');
    await waitFor(() => left.migrationPending() && right.migrationPending());
    const [one, two] = await Promise.all([
      left.migrateSeed([first, second], actor),
      right.migrateSeed([first, second], actor),
    ]);
    expect(one.error).toBeUndefined();
    expect(two.error).toBeUndefined();
    expect(one.added + two.added).toBe(2);
    expect(one.skipped + two.skipped).toBe(2);
    expect(await storedText(first.id)).toBe('同時A');
    expect(await storedText(second.id)).toBe('同時B');
  });
});

describe.skipIf(!emulatorUp)('display name refresh', () => {
  async function raw(id: string): Promise<Record<string, unknown> | null> {
    let data: Record<string, unknown> | null = null;
    await env.withSecurityRulesDisabled(async (context) => {
      const snap = await getDoc(doc(context.firestore(), `dajare/${id}`));
      data = snap.exists() ? snap.data() : null;
    });
    return data;
  }

  function millis(value: unknown): number | null {
    if (
      value &&
      typeof value === 'object' &&
      'toMillis' in value &&
      typeof value.toMillis === 'function'
    ) {
      return value.toMillis();
    }
    return null;
  }

  it('本文と日時を残したまま、自分の表示名だけをそろえる', async () => {
    const store = createFirestoreStore(
      editorAuth().firestore() as unknown as Firestore,
      () => actor,
    );
    const ownId = seedId(220);
    const mixedId = seedId(221);
    const otherId = seedId(222);
    const created = await store.create(sampleDraft('元の本文'), actor, ownId);
    expect(created.ok).toBe(true);
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'editors/editor@example.com'), { publicName: 'まひろ' });
      await setDoc(doc(db, `dajare/${mixedId}`), {
        ...entry(mixedId),
        text: '直した人だけ',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        createdBy: { uid: 'other-uid', name: 'ほかの人' },
        updatedBy: { uid: 'editor-uid', name: '編集者' },
      });
      await setDoc(doc(db, `dajare/${otherId}`), {
        ...entry(otherId),
        text: '他人の紙',
        createdAt: new Date('2026-03-01T00:00:00Z'),
        updatedAt: new Date('2026-03-02T00:00:00Z'),
        createdBy: { uid: 'other-uid', name: 'ほかの人' },
        updatedBy: { uid: 'other-uid', name: 'ほかの人' },
      });
    });
    await waitFor(
      () =>
        store.getItems().some((item) => item.id === ownId) &&
        store.getItems().some((item) => item.id === mixedId) &&
        store.getItems().some((item) => item.id === otherId),
    );
    const beforeOwn = await raw(ownId);
    const beforeMixed = await raw(mixedId);
    const progress: number[] = [];
    const first = await store.refreshOwnNames({ uid: 'editor-uid', name: 'まひろ' }, (done) => {
      progress.push(done);
    });
    expect(first.error).toBeUndefined();
    expect(first.updated).toBe(2);
    expect(first.failed).toBe(0);
    expect(progress).toEqual([1, 2]);
    const afterOwn = await raw(ownId);
    const afterMixed = await raw(mixedId);
    const afterOther = await raw(otherId);
    expect(afterOwn?.text).toBe('元の本文');
    expect(afterOwn?.createdBy).toEqual({ uid: 'editor-uid', name: 'まひろ' });
    expect(afterOwn?.updatedBy).toEqual({ uid: 'editor-uid', name: 'まひろ' });
    expect(millis(afterOwn?.createdAt)).toBe(millis(beforeOwn?.createdAt));
    expect(millis(afterOwn?.updatedAt)).toBe(millis(beforeOwn?.updatedAt));
    expect(afterMixed?.text).toBe('直した人だけ');
    expect(afterMixed?.createdBy).toEqual({ uid: 'other-uid', name: 'ほかの人' });
    expect(afterMixed?.updatedBy).toEqual({ uid: 'editor-uid', name: 'まひろ' });
    expect(millis(afterMixed?.createdAt)).toBe(millis(beforeMixed?.createdAt));
    expect(millis(afterMixed?.updatedAt)).toBe(millis(beforeMixed?.updatedAt));
    expect(afterOther?.text).toBe('他人の紙');
    expect(afterOther?.createdBy).toEqual({ uid: 'other-uid', name: 'ほかの人' });
    expect(afterOther?.updatedBy).toEqual({ uid: 'other-uid', name: 'ほかの人' });
    const second = await store.refreshOwnNames({ uid: 'editor-uid', name: 'まひろ' });
    expect(second.updated).toBe(0);
    expect(second.failed).toBe(0);
    expect(await storedText(ownId)).toBe('元の本文');
  });
});
