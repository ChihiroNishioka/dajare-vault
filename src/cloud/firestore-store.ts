import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { Actor, Dajare, DajareDraft } from '../types';
import type { DajareStore } from '../store/dajare-store';

const COLLECTION = 'dajare';

function toIso(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  if (typeof value === 'string') return value;
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function actorOf(value: unknown): Actor | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.uid !== 'string' ||
    typeof row.email !== 'string' ||
    typeof row.name !== 'string'
  ) {
    return null;
  }
  return { uid: row.uid, email: row.email, name: row.name };
}

export function dajareFromDoc(id: string, data: Record<string, unknown>): Dajare {
  return {
    id,
    text: String(data.text ?? ''),
    scene: String(data.scene ?? ''),
    addedAt: typeof data.addedAt === 'string' ? data.addedAt : null,
    addedAtNote: typeof data.addedAtNote === 'string' ? data.addedAtNote : '',
    reading: typeof data.reading === 'string' ? data.reading : '',
    source: typeof data.source === 'string' ? data.source : '',
    rating:
      data.rating === 1 ||
      data.rating === 2 ||
      data.rating === 3 ||
      data.rating === 4 ||
      data.rating === 5
        ? data.rating
        : null,
    favorite: data.favorite === true,
    tags: Array.isArray(data.tags)
      ? data.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    speakers: Array.isArray(data.speakers)
      ? data.speakers.filter((name): name is string => typeof name === 'string')
      : [],
    memo: typeof data.memo === 'string' ? data.memo : '',
    updatedAt: toIso(data.updatedAt),
    createdAt: toIso(data.createdAt),
    createdBy: actorOf(data.createdBy),
    updatedBy: actorOf(data.updatedBy),
  };
}

function payload(
  draft: DajareDraft,
  actor: Actor,
  previous: { createdAt: unknown; createdBy: unknown } | null,
) {
  return {
    text: draft.text.trim(),
    scene: draft.scene.trim(),
    addedAt: draft.addedAt,
    addedAtNote: draft.addedAtNote.trim(),
    reading: draft.reading.trim(),
    source: draft.source.trim(),
    rating: draft.rating,
    favorite: draft.favorite,
    tags: draft.tags,
    speakers: draft.speakers,
    memo: draft.memo.trim(),
    createdAt: previous ? previous.createdAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: previous ? previous.createdBy : actor,
    updatedBy: actor,
  };
}

export function createFirestoreStore(db: Firestore, actor: () => Actor | null): DajareStore {
  let items: Dajare[] = [];
  const listeners = new Set<(next: Dajare[]) => void>();

  const emit = (): void => {
    for (const listener of listeners) listener(items);
  };

  const ready = new Promise<void>((resolve) => {
    onSnapshot(collection(db, COLLECTION), (snap) => {
      items = snap.docs.map((row) => dajareFromDoc(row.id, row.data() as Record<string, unknown>));
      emit();
      resolve();
    });
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(items);
      return () => listeners.delete(listener);
    },
    getItems: () => items,
    async create(draft, who, id) {
      const person = who ?? actor();
      if (!person) return { ok: false, error: 'ログインが必要です' };
      const itemId = id ?? crypto.randomUUID();
      try {
        const batch = writeBatch(db);
        batch.set(
          doc(db, COLLECTION, itemId),
          payload({ ...draft, text: draft.text.trim(), scene: draft.scene.trim() }, person, null),
        );
        await batch.commit();
        await ready;
        const saved = items.find((row) => row.id === itemId);
        return saved
          ? { ok: true, item: saved }
          : {
              ok: true,
              item: {
                ...draft,
                id: itemId,
                updatedAt: '',
                createdBy: person,
                updatedBy: person,
                text: draft.text.trim(),
                scene: draft.scene.trim(),
                reading: draft.reading.trim(),
                source: draft.source.trim(),
                memo: draft.memo.trim(),
                addedAtNote: draft.addedAtNote.trim(),
              },
            };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '保存できませんでした',
        };
      }
    },
    async update(id, draft, who) {
      const person = who ?? actor();
      if (!person) return { ok: false, error: 'ログインが必要です' };
      const previous = items.find((row) => row.id === id);
      if (!previous) return { ok: false, error: '見つかりませんでした' };
      try {
        await updateDoc(doc(db, COLLECTION, id), {
          text: draft.text.trim(),
          scene: draft.scene.trim(),
          addedAt: draft.addedAt,
          addedAtNote: draft.addedAtNote.trim(),
          reading: draft.reading.trim(),
          source: draft.source.trim(),
          rating: draft.rating,
          favorite: draft.favorite,
          tags: draft.tags,
          speakers: draft.speakers,
          memo: draft.memo.trim(),
          updatedAt: serverTimestamp(),
          updatedBy: person,
        });
        return { ok: true, item: items.find((row) => row.id === id) ?? previous };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '保存できませんでした',
        };
      }
    },
    async remove(id) {
      try {
        await deleteDoc(doc(db, COLLECTION, id));
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '削除できませんでした',
        };
      }
    },
    async bulkImport(incoming, person) {
      const existing = new Set(
        (await getDocs(collection(db, COLLECTION))).docs.map((row) => row.id),
      );
      const fresh = incoming.filter((item) => !existing.has(item.id));
      const skipped = incoming.length - fresh.length;
      let added = 0;
      for (let i = 0; i < fresh.length; i += 400) {
        const batch = writeBatch(db);
        for (const item of fresh.slice(i, i + 400)) {
          batch.set(
            doc(db, COLLECTION, item.id),
            payload(
              {
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
              },
              person,
              null,
            ),
          );
          added += 1;
        }
        try {
          await batch.commit();
        } catch (error) {
          return {
            added,
            skipped,
            error: error instanceof Error ? error.message : '共有DBへ送れませんでした',
          };
        }
      }
      return { added, skipped };
    },
  };
}
