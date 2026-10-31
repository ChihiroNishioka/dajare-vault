import type { Dajare } from '../types';
import type { DajareStore } from './dajare-store';
import { createStore, type Store, type StoreOptions } from './store';
import type { KeyValueStorage } from './memory';

export function createLocalDajareStore(
  storage: KeyValueStorage,
  options: StoreOptions = {},
): DajareStore & { inner: Store } {
  const inner = createStore(storage, options);
  return {
    inner,
    subscribe(listener) {
      listener(inner.getState().items);
      return inner.subscribe(() => listener(inner.getState().items));
    },
    getItems: () => inner.getState().items,
    async create(draft, actor, id) {
      const result = inner.add(draft, { actor, id });
      if (!result.ok)
        return { ok: false, error: result.errors[0]?.message ?? '保存できませんでした' };
      return { ok: true, item: result.item };
    },
    async update(id, draft, actor) {
      const result = inner.update(id, draft, { actor });
      if (!result.ok)
        return { ok: false, error: result.errors[0]?.message ?? '保存できませんでした' };
      return { ok: true, item: result.item };
    },
    async remove(id) {
      const ok = inner.remove(id);
      return ok
        ? { ok: true }
        : { ok: false, error: inner.getState().saveError ?? '削除できませんでした' };
    },
    async bulkImport(items, actor) {
      let added = 0;
      let skipped = 0;
      for (const item of items) {
        if (inner.getState().items.some((row) => row.id === item.id)) {
          skipped += 1;
          continue;
        }
        const result = inner.add(toDraft(item), { actor, id: item.id });
        if (!result.ok) return { added, skipped, error: result.errors[0]?.message };
        added += 1;
      }
      return { added, skipped };
    },
  };
}

function toDraft(item: Dajare) {
  return {
    text: item.text,
    scene: item.scene,
    addedAt: item.addedAt,
    addedAtNote: item.addedAtNote,
    reading: item.reading,
    source: item.source,
    rating: item.rating,
    favorite: item.favorite,
    tags: item.tags,
    speakers: item.speakers,
    memo: item.memo,
  };
}
