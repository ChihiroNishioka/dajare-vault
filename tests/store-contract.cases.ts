import { expect, it } from 'vitest';
import type { Actor, Dajare, DajareDraft } from '../src/types';
import type { DajareStore } from '../src/store/dajare-store';
import { seedId } from '../src/domain/ids';

export const actor: Actor = {
  uid: 'editor-uid',
  email: 'editor@example.com',
  name: '編集者',
};

export function sampleDraft(text = '契約の試し'): DajareDraft {
  return {
    text,
    scene: '試験',
    addedAt: '2026-04-01',
    addedAtNote: '',
    reading: '',
    source: '',
    rating: 2,
    favorite: false,
    tags: ['試験'],
    speakers: [],
    memo: '',
  };
}

async function until(store: DajareStore, pred: (items: Dajare[]) => boolean): Promise<void> {
  if (pred(store.getItems())) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error('store did not update'));
    }, 5000);
    const stop = store.subscribe((items) => {
      if (!pred(items)) return;
      clearTimeout(timer);
      stop();
      resolve();
    });
  });
}

export function registerStoreContract(open: () => Promise<DajareStore>): void {
  it('creates, updates, and deletes one pun', async () => {
    const store = await open();
    const created = await store.create(sampleDraft(), actor);
    expect(created.ok).toBe(true);
    await until(store, (items) => items.some((item) => item.text === '契約の試し'));
    const id = store.getItems().find((item) => item.text === '契約の試し')?.id;
    expect(id).toBeTruthy();
    const updated = await store.update(id ?? '', sampleDraft('直した試し'), actor);
    expect(updated.ok).toBe(true);
    await until(store, (items) => items.some((item) => item.text === '直した試し'));
    const removed = await store.remove(id ?? '');
    expect(removed.ok).toBe(true);
    await until(store, (items) => items.every((item) => item.id !== id));
  });

  it('bulkImport skips ids that are already there', async () => {
    const store = await open();
    const first: Dajare = {
      ...sampleDraft('一度目'),
      id: seedId(40),
      updatedAt: '2026-04-01T00:00:00Z',
    };
    const second: Dajare = {
      ...sampleDraft('二度目'),
      id: seedId(41),
      updatedAt: '2026-04-01T00:00:00Z',
    };
    const imported = await store.bulkImport([first, second], actor);
    expect(imported.added).toBe(2);
    expect(imported.error).toBeUndefined();
    await until(store, (items) => items.some((item) => item.id === seedId(41)));
    const again = await store.bulkImport([first, second], actor);
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(2);
  });
}
