import type { Dajare } from '../types';
import type { DajareStore, ImportTally, WriteResult } from './dajare-store';
import { createStore, type Store, type StoreOptions } from './store';
import type { KeyValueStorage } from './memory';

export function adaptLocalStore(inner: Store): DajareStore {
  const bulkImport = async (
    items: Dajare[],
    actor: Parameters<DajareStore['bulkImport']>[1],
  ): Promise<ImportTally> => {
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
  };

  return {
    subscribe(listener) {
      listener(inner.getState().items);
      return inner.subscribe(() => listener(inner.getState().items));
    },
    getItems: () => inner.getState().items,
    migrationPending: () => false,
    readError: () => null,
    async create(draft, actor, id): Promise<WriteResult> {
      const result = inner.add(draft, { actor, id });
      if (!result.ok) {
        return { ok: false, error: result.errors[0]?.message, errors: result.errors };
      }
      return { ok: true, item: result.item };
    },
    async update(id, draft, actor): Promise<WriteResult> {
      const result = inner.update(id, draft, { actor });
      if (!result.ok) {
        return { ok: false, error: result.errors[0]?.message, errors: result.errors };
      }
      return { ok: true, item: result.item };
    },
    async remove(id): Promise<WriteResult> {
      const ok = inner.remove(id);
      return ok
        ? { ok: true }
        : { ok: false, error: inner.getState().saveError ?? '削除できませんでした' };
    },
    bulkImport,
    migrateSeed: (items, actor) => bulkImport(items, actor),
  };
}

export function createLocalDajareStore(
  storage: KeyValueStorage,
  options: StoreOptions = {},
): DajareStore & { inner: Store } {
  const inner = createStore(storage, options);
  return { inner, ...adaptLocalStore(inner) };
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
