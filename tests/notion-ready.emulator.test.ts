import { vi } from 'vitest';

const { snapshotCalls } = vi.hoisted(() => ({ snapshotCalls: [] as unknown[][] }));

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
  return {
    ...actual,
    onSnapshot: (...args: unknown[]) => {
      snapshotCalls.push(args);
      return (actual.onSnapshot as (...inner: unknown[]) => () => void)(...args);
    },
  };
});

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, type Firestore } from 'firebase/firestore';
import { createFirestoreStore } from '../src/cloud/firestore-store';
import { seedId } from '../src/domain/ids';

const PROJECT = 'demo-dajare';
let env: RulesTestEnvironment;

const emulatorUp = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

async function until(pred: () => boolean): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > 5000) throw new Error('共有の紙がサーバーで確認されません');
    await new Promise((resolve) => setTimeout(resolve, 25)); // discipline-allow polling
  }
}

describe.skipIf(!emulatorUp)('notion backup waits for the server snapshot', () => {
  beforeAll(async () => {
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

  it('サーバー確認が届いてから保管を始められる', async () => {
    const id = seedId(310);
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `dajare/${id}`), {
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
        createdAt: new Date('2026-10-02T00:00:00Z'),
        updatedAt: new Date('2026-10-02T00:00:00Z'),
        createdBy: { uid: 'editor-uid', name: '編集者' },
        updatedBy: { uid: 'editor-uid', name: '編集者' },
      });
    });
    snapshotCalls.length = 0;
    const db = env
      .authenticatedContext('editor-uid', {
        email: 'editor@example.com',
        email_verified: true,
      })
      .firestore() as unknown as Firestore;
    const store = createFirestoreStore(db, () => ({ uid: 'editor-uid', name: '編集者' }));
    await until(() => store.getItems().some((item) => item.id === id) && store.hasServerSnapshot());
    const sawServer = snapshotCalls.some((args) =>
      args.some(
        (arg) =>
          arg !== null &&
          typeof arg === 'object' &&
          'includeMetadataChanges' in arg &&
          (arg as { includeMetadataChanges?: boolean }).includeMetadataChanges === true,
      ),
    );
    expect(sawServer).toBe(true);
    expect(store.hasServerSnapshot()).toBe(true);
    expect(store.getItems().some((item) => item.id === id)).toBe(true);
  });
});
