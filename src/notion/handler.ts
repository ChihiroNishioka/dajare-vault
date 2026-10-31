import { backupCors } from './cors';
import type { ArchiveItem, NotionRelay } from './notion-api';
import { dedupeEntries, type NotionDajare } from './plan';

export interface BackupHandlerDeps {
  nowSec: () => number;
  verifyToken: (idToken: string) => Promise<{ email: string; uid: string }>;
  confirmEditor: (email: string, idToken: string) => Promise<boolean>;
  notion: NotionRelay;
}

function json(body: unknown, status: number, cors: Record<string, string> | null): Response {
  const headers = new Headers(cors ?? undefined);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

function isEntry(value: unknown): value is NotionDajare {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    row.id.length <= 80 &&
    typeof row.text === 'string' &&
    row.text.length <= 2000 &&
    typeof row.scene === 'string' &&
    (row.addedAt === null || typeof row.addedAt === 'string') &&
    typeof row.addedAtNote === 'string' &&
    typeof row.reading === 'string' &&
    typeof row.source === 'string' &&
    (row.rating === null || typeof row.rating === 'number') &&
    typeof row.favorite === 'boolean' &&
    Array.isArray(row.tags) &&
    Array.isArray(row.speakers) &&
    typeof row.memo === 'string' &&
    typeof row.updatedAt === 'string'
  );
}

export async function handleNotionBackup(
  request: Request,
  deps: BackupHandlerDeps,
): Promise<Response> {
  const origin = request.headers.get('origin');
  const cors = backupCors(origin);
  if (request.method === 'OPTIONS') {
    if (!cors) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors });
  }
  if (!cors) return json({ error: 'このページからは保管できません' }, 403, null);
  if (request.method !== 'POST') return json({ error: '受け付けていません' }, 405, cors);

  const header = request.headers.get('authorization') ?? '';
  const idToken = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!idToken) return json({ error: 'ログインが必要です' }, 401, cors);

  let identity: { email: string; uid: string };
  try {
    identity = await deps.verifyToken(idToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ログインを確認できません';
    return json({ error: message }, 401, cors);
  }
  let editor = false;
  try {
    editor = await deps.confirmEditor(identity.email, idToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : '編集者の確認ができませんでした';
    return json({ error: message }, 503, cors);
  }
  if (!editor) return json({ error: '編集者だけが Notion に保管できます' }, 403, cors);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: '依頼の形が違います' }, 400, cors);
  }
  const row = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  try {
    if (row.op === 'ensure') return json(await deps.notion.ensure(), 200, cors);
    if (row.op === 'upsert') {
      if (
        typeof row.databaseId !== 'string' ||
        !Array.isArray(row.entries) ||
        row.entries.length > 20
      ) {
        return json({ error: '依頼の形が違います' }, 400, cors);
      }
      if (!row.entries.every(isEntry)) return json({ error: '依頼の形が違います' }, 400, cors);
      return json(await deps.notion.upsert(row.databaseId, dedupeEntries(row.entries)), 200, cors);
    }
    if (row.op === 'archive') {
      if (
        typeof row.databaseId !== 'string' ||
        !Array.isArray(row.liveIds) ||
        row.liveIds.length > 5000
      ) {
        return json({ error: '依頼の形が違います' }, 400, cors);
      }
      const liveIds = row.liveIds.filter((id): id is string => typeof id === 'string');
      const pending = Array.isArray(row.pending)
        ? row.pending.filter(
            (item): item is ArchiveItem =>
              Boolean(item) &&
              typeof item === 'object' &&
              typeof (item as ArchiveItem).pageId === 'string' &&
              typeof (item as ArchiveItem).dajareId === 'string',
          )
        : [];
      const cursor = typeof row.cursor === 'string' ? row.cursor : null;
      return json(await deps.notion.archive(row.databaseId, liveIds, cursor, pending), 200, cors);
    }
    if (row.op === 'finish') {
      if (typeof row.databaseId !== 'string')
        return json({ error: '依頼の形が違います' }, 400, cors);
      const at = new Date(deps.nowSec() * 1000).toISOString();
      return json(await deps.notion.finish(row.databaseId, at), 200, cors);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Notionへの保管に失敗しました';
    return json({ error: message }, 502, cors);
  }
  return json({ error: '依頼の形が違います' }, 400, cors);
}
