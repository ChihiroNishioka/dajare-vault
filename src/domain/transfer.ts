import { applyMigrations } from '../migrations/runner';
import { CURRENT_SCHEMA_VERSION, type Dajare, type DajareDraft } from '../types';
import { isUtcSeconds, isUuidV4, toUtcSeconds } from './ids';
import { validateDraft } from './validate';

export interface IdConflict {
  incoming: Dajare;
  existing: Dajare;
}

export interface TextSceneDupe {
  incoming: Dajare;
  existing: Dajare;
}

export interface ImportPlan {
  fresh: Dajare[];
  idConflicts: IdConflict[];
  textSceneDupes: TextSceneDupe[];
}

export interface ImportDecisions {
  idActions: Record<string, 'skip' | 'overwrite'>;
  acceptTextSceneIds: string[];
}

export function textSceneKey(item: Pick<Dajare, 'text' | 'scene'>): string {
  return `${item.text.trim()}\u0000${item.scene.trim()}`;
}

export function serialize(items: Dajare[]): string {
  return `${JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, items }, null, 2)}\n`;
}

export function exportFilename(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `dajare-vault-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function coerceItem(
  input: unknown,
  index: number,
): { ok: true; item: Dajare } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: `items[${index}] がオブジェクトではありません` };
  }
  const row = input as Record<string, unknown>;
  const ratingRaw = row.rating;
  let rating: number | null = null;
  if (ratingRaw !== null && ratingRaw !== undefined && ratingRaw !== '') {
    rating = typeof ratingRaw === 'number' ? ratingRaw : Number(ratingRaw);
    if (Number.isNaN(rating)) rating = Number.NaN;
  }
  const draft: DajareDraft = {
    text: str(row.text),
    scene: str(row.scene),
    addedAt: row.addedAt === null || row.addedAt === '' ? null : str(row.addedAt),
    addedAtNote: str(row.addedAtNote),
    reading: str(row.reading),
    source: str(row.source),
    rating: rating as DajareDraft['rating'],
    favorite: Boolean(row.favorite),
    tags: Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [],
    speakers: Array.isArray(row.speakers) ? row.speakers.map((name) => String(name)) : [],
    memo: str(row.memo),
  };
  const validated = validateDraft(draft);
  if (!validated.ok) {
    return {
      ok: false,
      error: `items[${index}]: ${validated.errors.map((error) => error.message).join('、')}`,
    };
  }
  const id = str(row.id);
  if (!isUuidV4(id)) return { ok: false, error: `items[${index}] の id が不正です` };
  const updatedRaw = str(row.updatedAt);
  const updatedAt = isUtcSeconds(updatedRaw) ? updatedRaw : toUtcSeconds(new Date());
  return { ok: true, item: { ...validated.value, id, updatedAt } };
}

export function parseVault(
  input: unknown,
): { ok: true; items: Dajare[] } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'JSONの形が正しくありません' };
  }
  const row = input as Record<string, unknown>;
  if (typeof row.schemaVersion !== 'number' || !Array.isArray(row.items)) {
    return { ok: false, error: 'schemaVersion と items が必要です' };
  }
  if (row.schemaVersion > CURRENT_SCHEMA_VERSION || row.schemaVersion < 1) {
    return { ok: false, error: '対応していないバージョンです' };
  }
  let migrated;
  try {
    migrated = applyMigrations(
      { schemaVersion: row.schemaVersion, items: row.items },
      CURRENT_SCHEMA_VERSION,
    );
  } catch {
    return { ok: false, error: '移行できませんでした' };
  }
  const items: Dajare[] = [];
  for (let i = 0; i < migrated.items.length; i += 1) {
    const coerced = coerceItem(migrated.items[i], i);
    if (!coerced.ok) return coerced;
    items.push(coerced.item);
  }
  return { ok: true, items };
}

export function planImport(existing: Dajare[], incoming: Dajare[]): ImportPlan {
  const byId = new Map(existing.map((item) => [item.id, item]));
  const byKey = new Map(existing.map((item) => [textSceneKey(item), item]));
  const fresh: Dajare[] = [];
  const idConflicts: IdConflict[] = [];
  const textSceneDupes: TextSceneDupe[] = [];
  for (const item of incoming) {
    const sameId = byId.get(item.id);
    if (sameId) {
      idConflicts.push({ incoming: item, existing: sameId });
      continue;
    }
    const sameText = byKey.get(textSceneKey(item));
    if (sameText) {
      textSceneDupes.push({ incoming: item, existing: sameText });
      continue;
    }
    fresh.push(item);
  }
  return { fresh, idConflicts, textSceneDupes };
}

export function applyImport(
  existing: Dajare[],
  plan: ImportPlan,
  decisions: ImportDecisions,
): { items: Dajare[]; added: number; overwritten: number; skipped: number } {
  const items = existing.map((item) => ({ ...item }));
  let added = 0;
  let overwritten = 0;
  let skipped = 0;
  for (const row of plan.idConflicts) {
    const action = decisions.idActions[row.incoming.id] ?? 'skip';
    if (action === 'overwrite') {
      const index = items.findIndex((item) => item.id === row.incoming.id);
      if (index >= 0) items[index] = { ...row.incoming };
      overwritten += 1;
    } else {
      skipped += 1;
    }
  }
  for (const row of plan.textSceneDupes) {
    if (decisions.acceptTextSceneIds.includes(row.incoming.id)) {
      items.push({ ...row.incoming });
      added += 1;
    } else {
      skipped += 1;
    }
  }
  for (const item of plan.fresh) {
    items.push({ ...item });
    added += 1;
  }
  return { items, added, overwritten, skipped };
}

export const emptyDecisions = (): ImportDecisions => ({
  idActions: {},
  acceptTextSceneIds: [],
});
