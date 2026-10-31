import { describe, expect, it } from 'vitest';
import { DATA_KEY } from '../src/types';
import { seedId } from '../src/domain/ids';
import { memoryStorage } from '../src/store/memory';
import { createStore } from '../src/store/store';
import type { Dajare, VaultFile } from '../src/types';
import seed from '../src/data/seed.json';

const tiny: VaultFile = {
  schemaVersion: 2,
  items: [
    {
      id: seedId(1),
      text: 'ひとつめ',
      scene: '場面',
      addedAt: '2026-10-01',
      addedAtNote: '',
      reading: '',
      source: '',
      rating: null,
      favorite: false,
      tags: [],
      speakers: [],
      updatedAt: '2026-10-01T00:00:00Z',
      memo: '',
    },
  ],
};

describe('createStore', () => {
  it('seeds only when storage is empty', () => {
    const storage = memoryStorage();
    const first = createStore(storage, {
      seed: tiny,
      now: () => new Date('2026-10-31T00:00:00Z'),
      uuid: () => seedId(50),
    });
    expect(first.getState().items).toHaveLength(1);
    expect(storage.dump()[DATA_KEY]).toContain('ひとつめ');
    expect(first.remove(seedId(1))).toBe(true);
    const second = createStore(storage, { seed: tiny });
    expect(second.getState().items).toHaveLength(0);
  });

  it('adds, updates, and deletes', () => {
    let n = 0;
    const store = createStore(memoryStorage(), {
      seed: tiny,
      now: () => new Date('2026-10-31T03:04:05Z'),
      uuid: () => {
        n += 1;
        return seedId(60 + n);
      },
    });
    const added = store.add({
      text: '  新しい紙  ',
      scene: 'テスト',
      addedAt: null,
      addedAtNote: '',
      reading: '',
      source: '',
      rating: 4,
      favorite: true,
      tags: ['朝', '朝'],
      speakers: ['ママ'],
      memo: '',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.item.text).toBe('新しい紙');
    expect(added.item.addedAt).toBeNull();
    expect(added.item.tags).toEqual(['朝']);
    expect(added.item.updatedAt).toBe('2026-10-31T03:04:05Z');
    const updated = store.update(added.item.id, { ...added.item, text: '直した' });
    expect(updated.ok).toBe(true);
    expect(store.getState().items.find((row) => row.id === added.item.id)?.text).toBe('直した');
    expect(store.remove(added.item.id)).toBe(true);
    expect(store.getState().items.some((row) => row.id === added.item.id)).toBe(false);
    expect(store.add({ ...added.item, text: '' }).ok).toBe(false);
  });

  it('rolls back when storage is full', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    };
    const store = createStore(storage, { seed: tiny });
    expect(store.getState().saveError).toMatch(/保存できませんでした/);
    const before = store.getState().items.length;
    const result = store.add({
      text: '入らない',
      scene: '場面',
      addedAt: null,
      addedAtNote: '',
      reading: '',
      source: '',
      rating: null,
      favorite: false,
      tags: [],
      speakers: [],
      memo: '',
    });
    expect(result.ok).toBe(false);
    expect(store.getState().items).toHaveLength(before);
  });

  it('loads the committed seed the first time', () => {
    const store = createStore(memoryStorage());
    expect(store.getState().items).toHaveLength((seed as { items: Dajare[] }).items.length);
    expect(store.getState().loadError).toBeNull();
  });

  it('skips sample rows that are already stored', () => {
    const store = createStore(memoryStorage(), { seed: tiny });
    expect(store.loadSamples()).toEqual({ added: 0, skipped: 1 });
  });
});
