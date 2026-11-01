/** Notion に置く1件。メールアドレスは含めない。 */
export interface NotionDajare {
  id: string;
  text: string;
  scene: string;
  addedAt: string | null;
  addedAtNote: string;
  reading: string;
  source: string;
  rating: number | null;
  favorite: boolean;
  tags: string[];
  speakers: string[];
  memo: string;
  updatedAt: string;
  createdAt?: string;
  createdByName?: string;
  updatedByName?: string;
}

export interface NotionMatch {
  pageId: string;
  fingerprint: string;
  archived: boolean;
}

export type UpsertDecision = 'create' | 'update' | 'restore' | 'unchanged';
export type ArchiveDecision = 'archive' | 'skip';

export function fingerprintSource(entry: NotionDajare): string {
  return JSON.stringify([
    entry.text,
    entry.scene,
    entry.addedAt,
    entry.addedAtNote,
    entry.reading,
    entry.source,
    entry.rating,
    entry.favorite,
    entry.tags,
    entry.speakers,
    entry.memo,
    entry.updatedAt,
    entry.createdAt ?? '',
    entry.createdByName ?? '',
    entry.updatedByName ?? '',
  ]);
}

/** 照合列に置く短いハッシュ。長い本文を切らずに比べられる。 */
export async function entryFingerprint(entry: NotionDajare): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(fingerprintSource(entry)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 1回でしまってよい上限。これを超えるときは画面で確認してから。 */
export function archiveCap(existingRows: number): number {
  return Math.max(5, Math.ceil(existingRows * 0.2));
}

export function archiveNeedsConfirm(wouldArchive: number, existingRows: number): boolean {
  return wouldArchive > archiveCap(existingRows);
}

export type BackupBlock = 'loading' | 'empty' | 'error';

/** 空や読みかけの一覧では保管を始めない。ローカルは最初から揃っている。 */
export function backupBlockReason(input: {
  mode: 'local' | 'cloud';
  serverReady: boolean;
  readError: string | null;
  count: number;
}): BackupBlock | null {
  if (input.readError) return 'error';
  if (input.mode === 'cloud' && !input.serverReady) return 'loading';
  if (input.count <= 0) return 'empty';
  return null;
}

/** 同じ id は最後の1件だけ残す。 */
export function dedupeEntries(entries: NotionDajare[]): NotionDajare[] {
  const map = new Map<string, NotionDajare>();
  for (const entry of entries) map.set(entry.id, entry);
  return [...map.values()];
}

export function chunkEntries<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * 既存ページがあれば更新し、なければ作る。中身もアーカイブも同じなら書かない。
 * しまってある行が戻ってきたらアーカイブを外す。
 */
export function decideUpsert(hash: string, found: NotionMatch | null): UpsertDecision {
  if (!found) return 'create';
  if (found.archived) return 'restore';
  if (found.fingerprint === hash) return 'unchanged';
  return 'update';
}

/** Notion の id と、ブラウザから来た id の形。`..` は通さない。 */
export function isNotionId(value: string): boolean {
  return (
    /^[0-9a-f]{32}$/i.test(value) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/**
 * 保管庫に無い id の行はアーカイブする。ページ自体は消さない。
 * id を読めない行と、すでにしまってある行はそのままにする。
 */
export function decideArchive(
  dajareId: string | null,
  archived: boolean,
  liveIds: ReadonlySet<string>,
): ArchiveDecision {
  if (!dajareId || archived) return 'skip';
  if (liveIds.has(dajareId)) return 'skip';
  return 'archive';
}
