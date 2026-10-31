import type { Dajare } from '../types';
import { notionFailureMessage, notionProgress } from './messages';
import { chunkEntries, dedupeEntries, type NotionDajare } from './plan';

export const UPSERT_CHUNK = 10;

export function notionRelayUrl(): string {
  return import.meta.env.VITE_NOTION_RELAY_URL ?? '';
}

/** テストビルドだけ、未設定のときにモック用の宛先を使う。本番ビルドでは空。 */
export function notionRelayUrlForBackup(): string {
  const configured = notionRelayUrl();
  if (configured) return configured;
  if (import.meta.env.DEV || import.meta.env.VITE_FORCE_LOCAL === '1') {
    return 'https://notion-backup.test/notion-backup';
  }
  return '';
}

export function toNotionEntry(item: Dajare): NotionDajare {
  return {
    id: item.id,
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
    updatedAt: item.updatedAt,
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(item.createdBy?.name ? { createdByName: item.createdBy.name } : {}),
    ...(item.updatedBy?.name ? { updatedByName: item.updatedBy.name } : {}),
  };
}

export interface BackupCounts {
  created: number;
  updated: number;
  unchanged: number;
  archived: number;
  lastBackupAt: string;
}

export interface BackupProgress {
  done: number;
  total: number;
  label: string;
}

interface ArchiveItem {
  pageId: string;
  dajareId: string;
}

async function postJson(
  relayUrl: string,
  token: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(relayUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Notion保管のリレーに届きませんでした');
  }
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || notionFailureMessage('リレーが拒否しました'));
  return payload;
}

export async function runNotionBackup(options: {
  relayUrl: string;
  token: string;
  entries: NotionDajare[];
  fetchImpl?: typeof fetch;
  onProgress?: (progress: BackupProgress) => void;
}): Promise<BackupCounts> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const entries = dedupeEntries(options.entries);
  const post = (body: unknown) => postJson(options.relayUrl, options.token, body, fetchImpl);
  const ensured = (await post({ op: 'ensure' })) as { databaseId?: string };
  if (!ensured.databaseId) throw new Error('Notionのデータベースを用意できませんでした');
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const chunks = chunkEntries(entries, UPSERT_CHUNK);
  let done = 0;
  options.onProgress?.({
    done,
    total: entries.length,
    label: notionProgress(done, entries.length),
  });
  for (const chunk of chunks) {
    const tally = (await post({
      op: 'upsert',
      databaseId: ensured.databaseId,
      entries: chunk,
    })) as {
      created?: number;
      updated?: number;
      unchanged?: number;
    };
    created += tally.created ?? 0;
    updated += tally.updated ?? 0;
    unchanged += tally.unchanged ?? 0;
    done += chunk.length;
    options.onProgress?.({
      done,
      total: entries.length,
      label: notionProgress(done, entries.length),
    });
  }
  let archived = 0;
  let cursor: string | null = null;
  let pending: ArchiveItem[] = [];
  for (let round = 0; round < 100; round += 1) {
    const pass = (await post({
      op: 'archive',
      databaseId: ensured.databaseId,
      liveIds: entries.map((entry) => entry.id),
      cursor,
      pending,
    })) as { archived?: number; pending?: ArchiveItem[]; nextCursor?: string | null };
    archived += pass.archived ?? 0;
    pending = pass.pending ?? [];
    cursor = pass.nextCursor ?? null;
    if (pending.length === 0 && !cursor) break;
  }
  const finished = (await post({ op: 'finish', databaseId: ensured.databaseId })) as {
    lastBackupAt?: string;
  };
  if (!finished.lastBackupAt) throw new Error('最終保管の時刻を残せませんでした');
  return { created, updated, unchanged, archived, lastBackupAt: finished.lastBackupAt };
}
