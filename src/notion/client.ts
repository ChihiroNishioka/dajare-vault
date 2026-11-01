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
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (progress: BackupProgress) => void;
  onConfirmArchive?: (wouldArchive: number) => Promise<boolean>;
  onKnownBackup?: (iso: string) => void;
  shouldContinue?: () => boolean;
}): Promise<BackupCounts> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const entries = dedupeEntries(options.entries);
  if (entries.length === 0) throw new Error('紙がありません');
  const post = async (body: unknown) => {
    for (;;) {
      if (options.shouldContinue && !options.shouldContinue()) throw new Error('中止しました');
      const payload = (await postJson(options.relayUrl, options.token, body, fetchImpl)) as {
        retryAfterMs?: number;
      };
      if (payload?.retryAfterMs) {
        await sleep(payload.retryAfterMs);
        continue;
      }
      return payload;
    }
  };
  const ensured = (await post({ op: 'ensure' })) as {
    databaseId?: string;
    lastBackupAt?: string | null;
  };
  if (!ensured.databaseId) throw new Error('Notionのデータベースを用意できませんでした');
  if (ensured.lastBackupAt) options.onKnownBackup?.(ensured.lastBackupAt);
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
    let offset = 0;
    let stalls = 0;
    while (offset < chunk.length) {
      const tally = (await post({ op: 'upsert', entries: chunk.slice(offset) })) as {
        created?: number;
        updated?: number;
        unchanged?: number;
        resumeFrom?: number;
      };
      created += tally.created ?? 0;
      updated += tally.updated ?? 0;
      unchanged += tally.unchanged ?? 0;
      if (typeof tally.resumeFrom === 'number') {
        if (tally.resumeFrom < 0 || offset + tally.resumeFrom > chunk.length) {
          throw new Error('続きが分かりません');
        }
        if (tally.resumeFrom === 0) {
          stalls += 1;
          if (stalls > 3) throw new Error('続きが分かりません');
          continue;
        }
        stalls = 0;
        offset += tally.resumeFrom;
        continue;
      }
      offset = chunk.length;
    }
    done += chunk.length;
    options.onProgress?.({
      done,
      total: entries.length,
      label: notionProgress(done, entries.length),
    });
  }
  let archived = 0;
  let cursor: string | null = null;
  let confirm = false;
  for (let round = 0; round < 400; round += 1) {
    const pass = (await post({
      op: 'archive',
      liveIds: entries.map((entry) => entry.id),
      cursor,
      confirmArchive: confirm,
    })) as {
      archived?: number;
      nextCursor?: string | null;
      done?: boolean;
      counting?: boolean;
      needConfirm?: boolean;
      wouldArchive?: number;
    };
    if (pass.counting) {
      if (!pass.nextCursor) throw new Error('しまっておく続きが分かりません');
      cursor = pass.nextCursor;
      continue;
    }
    if (pass.needConfirm) {
      const ok = (await options.onConfirmArchive?.(pass.wouldArchive ?? 0)) ?? false;
      if (!ok) throw new Error('しまっておく確認がありません');
      confirm = true;
      cursor = null;
      continue;
    }
    archived += pass.archived ?? 0;
    if (pass.done) {
      const finished = (await post({ op: 'finish' })) as { lastBackupAt?: string };
      if (!finished.lastBackupAt) throw new Error('最終保管の時刻を残せませんでした');
      return { created, updated, unchanged, archived, lastBackupAt: finished.lastBackupAt };
    }
    if (!pass.nextCursor) throw new Error('しまっておく続きが分かりません');
    confirm = true;
    cursor = pass.nextCursor;
  }
  throw new Error('しまっておく処理が終わりませんでした');
}
