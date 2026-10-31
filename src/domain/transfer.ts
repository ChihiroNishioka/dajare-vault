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

export const MAX_IMPORT_ITEMS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function asString(
  value: unknown,
  field: string,
  fallback?: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if ((value === undefined || value === null) && fallback !== undefined) {
    return { ok: true, value: fallback };
  }
  if (typeof value !== 'string') return { ok: false, error: `${field} は文字列です` };
  return { ok: true, value };
}

function readStringList(
  value: unknown,
  field: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return { ok: false, error: `${field} は文字列の配列です` };
  }
  return { ok: true, value };
}

export function coerceItem(
  input: unknown,
  index: number,
): { ok: true; item: Dajare } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: `items[${index}] がオブジェクトではありません` };
  }
  const row = input as Record<string, unknown>;
  const text = asString(row.text, '本文');
  if (!text.ok) return { ok: false, error: `items[${index}]: ${text.error}` };
  const scene = asString(row.scene, 'シーン');
  if (!scene.ok) return { ok: false, error: `items[${index}]: ${scene.error}` };
  const reading = asString(row.reading, '読み', '');
  if (!reading.ok) return { ok: false, error: `items[${index}]: ${reading.error}` };
  const source = asString(row.source, '元ネタ', '');
  if (!source.ok) return { ok: false, error: `items[${index}]: ${source.error}` };
  const memo = asString(row.memo, 'メモ', '');
  if (!memo.ok) return { ok: false, error: `items[${index}]: ${memo.error}` };
  const addedAtNote = asString(row.addedAtNote, '日付メモ', '');
  if (!addedAtNote.ok) return { ok: false, error: `items[${index}]: ${addedAtNote.error}` };

  let addedAt: string | null;
  if (row.addedAt === undefined || row.addedAt === null || row.addedAt === '') addedAt = null;
  else if (typeof row.addedAt !== 'string') {
    return { ok: false, error: `items[${index}]: 追加日は文字列です` };
  } else addedAt = row.addedAt;

  let rating: number | null = null;
  if (row.rating !== undefined && row.rating !== null && row.rating !== '') {
    if (typeof row.rating !== 'number') {
      return { ok: false, error: `items[${index}]: 評価は数値です` };
    }
    rating = row.rating;
  }
  if (row.favorite !== undefined && typeof row.favorite !== 'boolean') {
    return { ok: false, error: `items[${index}]: お気に入りは真偽値です` };
  }
  const tags = readStringList(row.tags, 'タグ');
  if (!tags.ok) return { ok: false, error: `items[${index}]: ${tags.error}` };
  const speakers = readStringList(row.speakers, '言った人');
  if (!speakers.ok) return { ok: false, error: `items[${index}]: ${speakers.error}` };

  const draft: DajareDraft = {
    text: text.value,
    scene: scene.value,
    addedAt,
    addedAtNote: addedAtNote.value,
    reading: reading.value,
    source: source.value,
    rating: rating as DajareDraft['rating'],
    favorite: row.favorite === true,
    tags: tags.value,
    speakers: speakers.value,
    memo: memo.value,
  };
  const validated = validateDraft(draft);
  if (!validated.ok) {
    return {
      ok: false,
      error: `items[${index}]: ${validated.errors.map((error) => error.message).join('、')}`,
    };
  }
  const id = typeof row.id === 'string' ? row.id : '';
  if (!isUuidV4(id)) return { ok: false, error: `items[${index}] の id が不正です` };
  if (
    row.updatedAt !== undefined &&
    (typeof row.updatedAt !== 'string' || !isUtcSeconds(row.updatedAt))
  ) {
    return { ok: false, error: `items[${index}] の更新日時が不正です` };
  }
  const updatedAt = typeof row.updatedAt === 'string' ? row.updatedAt : toUtcSeconds(new Date());
  const createdBy = readActor(row.createdBy, index, 'createdBy');
  if (!createdBy.ok) return createdBy;
  const updatedBy = readActor(row.updatedBy, index, 'updatedBy');
  if (!updatedBy.ok) return updatedBy;
  const createdAt = asString(row.createdAt, 'createdAt', '');
  if (!createdAt.ok) return { ok: false, error: `items[${index}]: ${createdAt.error}` };
  return {
    ok: true,
    item: {
      ...validated.value,
      id,
      updatedAt,
      ...(createdAt.value ? { createdAt: createdAt.value } : {}),
      ...(createdBy.actor ? { createdBy: createdBy.actor } : {}),
      ...(updatedBy.actor ? { updatedBy: updatedBy.actor } : {}),
    },
  };
}

function readActor(
  value: unknown,
  index: number,
  field: string,
): { ok: true; actor: null | { uid: string; name: string } } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, actor: null };
  if (!value || typeof value !== 'object') {
    return { ok: false, error: `items[${index}] の ${field} が不正です` };
  }
  const row = value as Record<string, unknown>;
  if (typeof row.uid !== 'string' || typeof row.name !== 'string' || !row.uid || !row.name) {
    return { ok: false, error: `items[${index}] の ${field} が不正です` };
  }
  return { ok: true, actor: { uid: row.uid, name: row.name } };
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
  if (row.items.length > MAX_IMPORT_ITEMS) {
    return { ok: false, error: `件数は${MAX_IMPORT_ITEMS}件までです` };
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
  const seenIds = new Set<string>();
  for (let i = 0; i < migrated.items.length; i += 1) {
    const coerced = coerceItem(migrated.items[i], i);
    if (!coerced.ok) return coerced;
    if (seenIds.has(coerced.item.id)) {
      return { ok: false, error: `同じIDがファイルの中に複数あります（${coerced.item.id}）` };
    }
    seenIds.add(coerced.item.id);
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
    byId.set(item.id, item);
    byKey.set(textSceneKey(item), item);
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

function idLine(items: { id: string }[]): string {
  return items.map((item) => item.id).join('\n');
}

/** 確認画面と書き込みが同じ仕分けかを比べる。 */
export function planSignature(plan: ImportPlan): string {
  return [
    idLine(plan.fresh),
    idLine(plan.idConflicts.map((row) => row.incoming)),
    idLine(plan.textSceneDupes.map((row) => row.incoming)),
  ].join('\n---\n');
}

export function importWriteSet(
  plan: ImportPlan,
  decisions: ImportDecisions,
): { createIds: string[]; updateIds: string[] } {
  const updateIds = plan.idConflicts
    .filter((row) => (decisions.idActions[row.incoming.id] ?? 'skip') === 'overwrite')
    .map((row) => row.incoming.id);
  const createIds = [
    ...plan.fresh.map((item) => item.id),
    ...plan.textSceneDupes
      .filter((row) => decisions.acceptTextSceneIds.includes(row.incoming.id))
      .map((row) => row.incoming.id),
  ];
  return { createIds, updateIds };
}

/**
 * 確認画面を出したときの仕分けと、今の一覧が同じなら、その画面の id だけを書く。
 * 違っていれば書き込まず、新しい確認を返す。
 */
export function prepareImportCommit(
  existing: Dajare[],
  incoming: Dajare[],
  shown: ImportPlan,
  decisions: ImportDecisions,
):
  | { stale: true; plan: ImportPlan }
  | { stale: false; plan: ImportPlan; createIds: string[]; updateIds: string[] } {
  const plan = planImport(existing, incoming);
  if (planSignature(plan) !== planSignature(shown)) return { stale: true, plan };
  return { stale: false, plan, ...importWriteSet(plan, decisions) };
}

export interface DeviceUploadPlan {
  /** 見本以外で、共有DBにまだ無い紙。これだけ送る。 */
  send: Dajare[];
  /** 見本以外で、同じ id がすでにある件数。中身が違っても上書きしない。 */
  already: number;
  /** already のうち、本文などが違っている件数。 */
  different: number;
  /** この端末にある見本のうち、共有DBに無い件数。送らない。 */
  seedMissing: number;
}

function contentKey(item: Dajare): string {
  return JSON.stringify({
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
  });
}

/** 送るボタンは、見本以外の紙がこの端末にあるときだけ出す。 */
export function hasOwnDeviceData(localItems: Dajare[], seedIds: ReadonlySet<string>): boolean {
  return localItems.some((item) => !seedIds.has(item.id));
}

export function planDeviceUpload(
  localItems: Dajare[],
  sharedItems: Dajare[],
  seedIds: ReadonlySet<string>,
): DeviceUploadPlan {
  const sharedById = new Map(sharedItems.map((item) => [item.id, item]));
  const send: Dajare[] = [];
  let already = 0;
  let different = 0;
  let seedMissing = 0;
  for (const item of localItems) {
    if (seedIds.has(item.id)) {
      if (!sharedById.has(item.id)) seedMissing += 1;
      continue;
    }
    const shared = sharedById.get(item.id);
    if (!shared) {
      send.push(item);
      continue;
    }
    already += 1;
    if (contentKey(item) !== contentKey(shared)) different += 1;
  }
  return { send, already, different, seedMissing };
}

/** 1件も足せなかった送信は、送り終わったことにしない。 */
export function shouldMarkUploaded(result: { added: number; error?: string }): boolean {
  return !result.error && result.added > 0;
}
