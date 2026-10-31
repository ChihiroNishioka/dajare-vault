import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { CLOUD_NOT_READY } from './messages';
import { nameRefreshPatch, nameRefreshTargets } from './refresh-names';
import { SEED_IDS } from '../data/seed-ids';
import { timestampToIso } from '../domain/time';
import { validateDraft } from '../domain/validate';
import type { Actor, Dajare, DajareDraft } from '../types';
import type { DajareStore, ImportTally, NameRefreshResult } from '../store/dajare-store';

const COLLECTION = 'dajare';
const MIGRATION_PATH = ['meta', 'seedMigration'] as const;

type MigrationState = 'unknown' | 'pending' | 'done';

function actorOf(value: unknown): Actor | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.uid !== 'string' || typeof row.name !== 'string') return null;
  if (!row.uid || !row.name) return null;
  return { uid: row.uid, name: row.name };
}

export function dajareFromDoc(id: string, data: Record<string, unknown>): Dajare {
  const updatedAt = timestampToIso(data.updatedAt);
  const createdAt = timestampToIso(data.createdAt);
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
    updatedAt: updatedAt ?? '',
    ...(createdAt ? { createdAt } : {}),
    createdBy: actorOf(data.createdBy),
    updatedBy: actorOf(data.updatedBy),
  };
}

function contentOf(draft: DajareDraft) {
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
  };
}

function publicActor(actor: Actor): Actor {
  return { uid: actor.uid, name: actor.name };
}

function createFields(id: string, draft: DajareDraft, actor: Actor) {
  const who = publicActor(actor);
  return {
    id,
    ...contentOf(draft),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: who,
    updatedBy: who,
  };
}

function draftOf(item: Dajare): DajareDraft {
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

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

/** 同時に作ろうとすると、ルール拒否に見える競合が返ることがある。読み直してからもう一度。 */
async function withContentionRetry<T>(work: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      last = error;
      const code = errorCode(error);
      if (code !== 'permission-denied' && code !== 'aborted' && code !== 'failed-precondition') {
        throw error;
      }
    }
  }
  throw last;
}

function failureMessage(error: unknown, fallback: string): string {
  const code = errorCode(error);
  if (code === 'permission-denied') return fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 1件ずつ読み直す。すでに同じ名前なら書かない。本文や日時は送らない。 */
async function refreshOneName(
  db: Firestore,
  id: string,
  person: Actor,
): Promise<'updated' | 'skipped'> {
  const ref = doc(db, COLLECTION, id);
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return 'skipped';
        const data = snap.data();
        const patch = nameRefreshPatch(actorOf(data.createdBy), actorOf(data.updatedBy), person);
        if (!patch) return 'skipped';
        const write: { createdBy?: Actor; updatedBy?: Actor } = {};
        if (patch.createdBy) write.createdBy = patch.createdBy;
        if (patch.updatedBy) write.updatedBy = patch.updatedBy;
        tx.update(ref, write);
        return 'updated';
      });
    } catch (error) {
      last = error;
      const code = errorCode(error);
      if (code !== 'aborted' && code !== 'failed-precondition') throw error;
    }
  }
  throw last;
}

export function createFirestoreStore(db: Firestore, actor: () => Actor | null): DajareStore {
  let items: Dajare[] = [];
  let serverReady = false;
  let migrationState: MigrationState = 'unknown';
  let listError: string | null = null;
  let markerError: string | null = null;
  const listeners = new Set<(next: Dajare[]) => void>();

  const emit = (): void => {
    for (const listener of listeners) listener(items);
  };

  const listenError = (error: unknown, fallback: string): string =>
    errorCode(error) === 'permission-denied' ? CLOUD_NOT_READY : fallback;

  const readError = (): string | null => listError ?? markerError;

  onSnapshot(
    collection(db, COLLECTION),
    (snap) => {
      items = snap.docs.map((row) => dajareFromDoc(row.id, row.data() as Record<string, unknown>));
      if (!snap.metadata.fromCache) serverReady = true;
      listError = null;
      emit();
    },
    (error) => {
      listError = listenError(error, '共有の紙を読めませんでした');
      emit();
    },
  );

  onSnapshot(
    doc(db, ...MIGRATION_PATH),
    (snap) => {
      migrationState = snap.exists() ? 'done' : 'pending';
      markerError = null;
      emit();
    },
    (error) => {
      markerError = listenError(error, '共有の状態を読めませんでした');
      emit();
    },
  );

  const createIfAbsent = async (
    itemId: string,
    draft: DajareDraft,
    person: Actor,
  ): Promise<'created' | 'skipped'> => {
    const ref = doc(db, COLLECTION, itemId);
    const markerRef = doc(db, ...MIGRATION_PATH);
    return withContentionRetry(() =>
      runTransaction(db, async (tx) => {
        if (SEED_IDS.has(itemId)) {
          const marker = await tx.get(markerRef);
          if (marker.exists()) return 'skipped';
        }
        const snap = await tx.get(ref);
        if (snap.exists()) return 'skipped';
        tx.set(ref, createFields(itemId, draft, person));
        return 'created';
      }),
    );
  };

  const importMissing = async (incoming: Dajare[], person: Actor): Promise<ImportTally> => {
    let added = 0;
    let skipped = 0;
    for (const item of incoming) {
      try {
        const outcome = await createIfAbsent(item.id, draftOf(item), person);
        if (outcome === 'created') added += 1;
        else skipped += 1;
      } catch (error) {
        return { added, skipped, error: failureMessage(error, '共有DBへ送れませんでした') };
      }
    }
    return { added, skipped };
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(items);
      return () => listeners.delete(listener);
    },
    getItems: () => items,
    migrationPending: () => migrationState === 'pending',
    migrationDone: () => migrationState === 'done',
    readError,
    hasServerSnapshot: () => serverReady,
    async create(draft, who, id) {
      const person = who ?? actor();
      if (!person) return { ok: false, error: 'ログインが必要です' };
      const validated = validateDraft(draft);
      if (!validated.ok) {
        return {
          ok: false,
          error: validated.errors[0]?.message ?? '保存できませんでした',
          errors: validated.errors,
        };
      }
      const itemId = id ?? crypto.randomUUID();
      try {
        if (SEED_IDS.has(itemId)) {
          const outcome = await createIfAbsent(itemId, validated.value, person);
          if (outcome === 'skipped') return { ok: true, skipped: 'seed' };
          const saved = items.find((row) => row.id === itemId);
          return saved
            ? { ok: true, item: saved }
            : {
                ok: true,
                item: dajareFromDoc(itemId, {
                  ...contentOf(validated.value),
                  createdBy: publicActor(person),
                  updatedBy: publicActor(person),
                }),
              };
        }
        await setDoc(doc(db, COLLECTION, itemId), createFields(itemId, validated.value, person));
        const saved = items.find((row) => row.id === itemId);
        return saved
          ? { ok: true, item: saved }
          : {
              ok: true,
              item: dajareFromDoc(itemId, {
                ...contentOf(validated.value),
                createdBy: publicActor(person),
                updatedBy: publicActor(person),
              }),
            };
      } catch (error) {
        return { ok: false, error: failureMessage(error, '保存できませんでした') };
      }
    },
    async update(id, draft, who, options) {
      const person = who ?? actor();
      if (!person) return { ok: false, error: 'ログインが必要です' };
      const validated = validateDraft(draft);
      if (!validated.ok) {
        return {
          ok: false,
          error: validated.errors[0]?.message ?? '保存できませんでした',
          errors: validated.errors,
        };
      }
      const previous = items.find((row) => row.id === id);
      if (!previous) return { ok: false, error: '見つかりませんでした' };
      const patch = {
        ...contentOf(validated.value),
        updatedAt: serverTimestamp(),
        updatedBy: publicActor(person),
      };
      try {
        if (options?.expectedUpdatedAt) {
          const ref = doc(db, COLLECTION, id);
          let changed = false;
          await withContentionRetry(() =>
            runTransaction(db, async (tx) => {
              const snap = await tx.get(ref);
              if (!snap.exists()) {
                changed = true;
                return;
              }
              const current = timestampToIso(snap.get('updatedAt'));
              if (current !== options.expectedUpdatedAt) {
                changed = true;
                return;
              }
              tx.update(ref, patch);
            }),
          );
          if (changed) return { ok: true, skipped: 'changed' };
          return { ok: true, item: items.find((row) => row.id === id) ?? previous };
        }
        await updateDoc(doc(db, COLLECTION, id), patch);
        return { ok: true, item: items.find((row) => row.id === id) ?? previous };
      } catch (error) {
        return { ok: false, error: failureMessage(error, '保存できませんでした') };
      }
    },
    async remove(id) {
      try {
        await deleteDoc(doc(db, COLLECTION, id));
        return { ok: true };
      } catch (error) {
        return { ok: false, error: failureMessage(error, '削除できませんでした') };
      }
    },
    bulkImport(incoming, person) {
      return importMissing(incoming, person);
    },
    async refreshOwnNames(person, onProgress) {
      const ids = nameRefreshTargets(items, person).map((item) => item.id);
      let updated = 0;
      let skipped = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          const outcome = await refreshOneName(db, id, person);
          if (outcome === 'updated') updated += 1;
          else skipped += 1;
        } catch {
          failed += 1;
        }
        onProgress?.(updated + skipped + failed, ids.length);
      }
      const result: NameRefreshResult = { updated, skipped, failed };
      if (failed > 0) result.error = '表示をそろえられませんでした';
      return result;
    },
    async migrateSeed(incoming, person) {
      const marker = doc(db, ...MIGRATION_PATH);
      try {
        const existing = await getDoc(marker);
        if (existing.exists()) {
          migrationState = 'done';
          emit();
          return { added: 0, skipped: incoming.length };
        }
      } catch (error) {
        return {
          added: 0,
          skipped: 0,
          error: failureMessage(error, '共有の状態を読めませんでした'),
        };
      }
      const imported = await importMissing(incoming, person);
      if (imported.error) return imported;
      try {
        await withContentionRetry(() =>
          runTransaction(db, async (tx) => {
            const snap = await tx.get(marker);
            if (snap.exists()) return;
            tx.set(marker, { doneAt: serverTimestamp() });
          }),
        );
      } catch (error) {
        return {
          added: imported.added,
          skipped: imported.skipped,
          error: failureMessage(error, '移行の印を書けませんでした'),
        };
      }
      return imported;
    },
  };
}
