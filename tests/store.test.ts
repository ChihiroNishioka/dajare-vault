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

  it('does not save the seed on an empty shared-mode device', () => {
    const storage = memoryStorage();
    const store = createStore(storage, { seed: tiny, seedOnEmpty: false });
    expect(store.getState().items).toEqual([]);
    expect(storage.dump()[DATA_KEY]).toBeUndefined();
  });

  it('skips sample rows that are already stored', () => {
    const store = createStore(memoryStorage(), { seed: tiny });
    expect(store.loadSamples()).toEqual({ added: 0, skipped: 1 });
  });

  it('does not seed or overwrite when saved data cannot be read', () => {
    const original = JSON.stringify({
      schemaVersion: 2,
      items: [{ ...tiny.items[0], text: 'あ'.repeat(201) }],
    });
    const cases = [original, JSON.stringify({ schemaVersion: 4, items: tiny.items }), '{', ''];
    for (const raw of cases) {
      const storage = memoryStorage({ [DATA_KEY]: raw });
      const store = createStore(storage, {
        seed: tiny,
        uuid: () => seedId(70),
        now: () => new Date('2026-10-31T00:00:00Z'),
      });
      expect(store.getState().loadError).toBeTruthy();
      expect(store.getState().items).toEqual([]);
      const added = store.add({
        text: '足してしまう',
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
      expect(added.ok).toBe(false);
      expect(storage.dump()[DATA_KEY]).toBe(raw);
      const stashed = Object.entries(storage.dump()).filter(([key]) =>
        key.startsWith('dajareVault:broken:'),
      );
      expect(stashed).toHaveLength(1);
      expect(stashed[0]?.[1]).toBe(raw);
      expect(store.exportBroken()).toBe(raw);
    }
  });

  it('keeps going when storage itself throws', () => {
    const storage = memoryStorage();
    storage.getItem = () => {
      const error = new Error('blocked');
      error.name = 'SecurityError';
      throw error;
    };
    const store = createStore(storage, { seed: tiny });
    expect(store.getState().loadError).toMatch(/保存できません/);
    expect(store.getState().items).toEqual([]);
    expect(
      store.add({
        text: '書けない',
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
      }).ok,
    ).toBe(false);
  });
});
