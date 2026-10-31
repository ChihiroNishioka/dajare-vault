import {
  decideArchive,
  decideUpsert,
  entryFingerprint,
  type NotionDajare,
  type NotionMatch,
} from './plan';
import { createLimiter, NOTION_MIN_INTERVAL_MS, retryDelayMs } from './throttle';

const NOTION_VERSION = '2022-06-28';
const DATABASE_TITLE = '駄洒落';

export interface ArchiveItem {
  pageId: string;
  dajareId: string;
}

export interface ArchivePass {
  archived: number;
  pending: ArchiveItem[];
  nextCursor: string | null;
}

export interface NotionRelay {
  ensure(): Promise<{ databaseId: string; lastBackupAt: string | null }>;
  upsert(
    databaseId: string,
    entries: NotionDajare[],
  ): Promise<{ created: number; updated: number; unchanged: number }>;
  archive(
    databaseId: string,
    liveIds: string[],
    cursor: string | null,
    pending: ArchiveItem[],
  ): Promise<ArchivePass>;
  finish(databaseId: string, at: string): Promise<{ lastBackupAt: string }>;
}

function richText(value: string): { rich_text: { type: 'text'; text: { content: string } }[] } {
  if (!value) return { rich_text: [] };
  return { rich_text: [{ type: 'text', text: { content: value.slice(0, 2000) } }] };
}

function titleOf(text: string): { title: { type: 'text'; text: { content: string } }[] } {
  const oneLine = text.replace(/\s+/g, ' ').trim() || '（空）';
  return { title: [{ type: 'text', text: { content: oneLine.slice(0, 2000) } }] };
}

function plain(property: unknown): string {
  if (!property || typeof property !== 'object') return '';
  const row = property as {
    rich_text?: { plain_text?: string }[];
    title?: { plain_text?: string }[];
  };
  const parts = row.rich_text ?? row.title ?? [];
  return parts.map((part) => part.plain_text ?? '').join('');
}

function propertiesOf(entry: NotionDajare, archived: boolean) {
  return {
    本文: titleOf(entry.text),
    全文: richText(entry.text),
    id: richText(entry.id),
    場面: richText(entry.scene),
    読み: richText(entry.reading),
    出典: richText(entry.source),
    メモ: richText(entry.memo),
    追加日: richText(entry.addedAt ?? ''),
    追加日メモ: richText(entry.addedAtNote),
    評価: { number: entry.rating },
    お気に入り: { checkbox: entry.favorite },
    タグ: richText(entry.tags.join('\n')),
    言った人: richText(entry.speakers.join('\n')),
    作成: richText(entry.createdAt ?? ''),
    更新: richText(entry.updatedAt),
    書いた人: richText(entry.createdByName ?? ''),
    直した人: richText(entry.updatedByName ?? ''),
    照合: richText(entryFingerprint(entry)),
    アーカイブ: { checkbox: archived },
  };
}

const DATABASE_PROPERTIES = {
  本文: { title: {} },
  全文: { rich_text: {} },
  id: { rich_text: {} },
  場面: { rich_text: {} },
  読み: { rich_text: {} },
  出典: { rich_text: {} },
  メモ: { rich_text: {} },
  追加日: { rich_text: {} },
  追加日メモ: { rich_text: {} },
  評価: { number: { format: 'number' } },
  お気に入り: { checkbox: {} },
  タグ: { rich_text: {} },
  言った人: { rich_text: {} },
  作成: { rich_text: {} },
  更新: { rich_text: {} },
  書いた人: { rich_text: {} },
  直した人: { rich_text: {} },
  照合: { rich_text: {} },
  アーカイブ: { checkbox: {} },
};

function lastBackupFrom(description: unknown): string | null {
  const text = Array.isArray(description)
    ? description.map((part) => (part as { plain_text?: string }).plain_text ?? '').join('')
    : '';
  return text.match(/最終保管\s+(\S+)/)?.[1] ?? null;
}

export function createNotionClient(options: {
  token: string;
  pageId: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
}): NotionRelay {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const limit = createLimiter(options.intervalMs ?? NOTION_MIN_INTERVAL_MS, sleep);

  async function notion(path: string, init: { method: string; body?: unknown }): Promise<unknown> {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await limit();
      const headers: Record<string, string> = {
        authorization: `Bearer ${options.token}`,
        'notion-version': NOTION_VERSION,
      };
      if (init.body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetchImpl(`https://api.notion.com/v1${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      if (response.status === 429 || response.status >= 500) {
        lastStatus = response.status;
        await sleep(retryDelayMs(attempt, response.headers.get('retry-after')));
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error('Notionのトークンが拒否されました');
      }
      if (response.status === 404) throw new Error('Notionのページが統合に共有されていません');
      if (!response.ok) throw new Error('Notionへの保管に失敗しました');
      return response.json();
    }
    if (lastStatus === 429) throw new Error('Notionが混み合っています');
    throw new Error('Notionへの保管に失敗しました');
  }

  function matchOf(page: Record<string, unknown>): NotionMatch | null {
    const properties = page.properties as Record<string, unknown> | undefined;
    const id = plain(properties?.id);
    if (!id || typeof page.id !== 'string') return null;
    const archived = Boolean(
      (properties?.アーカイブ as { checkbox?: boolean } | undefined)?.checkbox,
    );
    return { pageId: page.id, fingerprint: plain(properties?.照合), archived };
  }

  async function findById(databaseId: string, id: string): Promise<NotionMatch[]> {
    const body = (await notion(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: { filter: { property: 'id', rich_text: { equals: id } }, page_size: 5 },
    })) as { results?: Record<string, unknown>[] };
    return (body.results ?? []).map(matchOf).filter((row): row is NotionMatch => row !== null);
  }

  async function write(
    pageId: string | null,
    databaseId: string,
    entry: NotionDajare,
    archived: boolean,
  ) {
    const properties = propertiesOf(entry, archived);
    if (pageId) {
      await notion(`/pages/${pageId}`, { method: 'PATCH', body: { properties } });
      return;
    }
    await notion('/pages', {
      method: 'POST',
      body: { parent: { database_id: databaseId }, properties },
    });
  }

  return {
    async ensure() {
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const query = cursor
          ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}`
          : '?page_size=100';
        const body = (await notion(`/blocks/${options.pageId}/children${query}`, {
          method: 'GET',
        })) as {
          results?: { id?: string; type?: string; child_database?: { title?: string } }[];
          has_more?: boolean;
          next_cursor?: string | null;
        };
        for (const block of body.results ?? []) {
          if (block.type !== 'child_database' || !block.id) continue;
          if (block.child_database?.title && block.child_database.title !== DATABASE_TITLE)
            continue;
          const database = (await notion(`/databases/${block.id}`, { method: 'GET' })) as {
            id: string;
            description?: unknown;
            properties?: Record<string, unknown>;
          };
          if (!database.properties?.id || !database.properties?.本文) continue;
          const missing: Record<string, unknown> = {};
          for (const [key, schema] of Object.entries(DATABASE_PROPERTIES)) {
            if (key !== '本文' && !database.properties[key]) missing[key] = schema;
          }
          if (Object.keys(missing).length > 0) {
            await notion(`/databases/${database.id}`, {
              method: 'PATCH',
              body: { properties: missing },
            });
          }
          return { databaseId: database.id, lastBackupAt: lastBackupFrom(database.description) };
        }
        if (!body.has_more || !body.next_cursor) break;
        cursor = body.next_cursor;
      }
      const created = (await notion('/databases', {
        method: 'POST',
        body: {
          parent: { type: 'page_id', page_id: options.pageId },
          title: [{ type: 'text', text: { content: DATABASE_TITLE } }],
          properties: DATABASE_PROPERTIES,
        },
      })) as { id: string };
      return { databaseId: created.id, lastBackupAt: null };
    },
    async upsert(databaseId, entries) {
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      for (const entry of entries) {
        const matches = await findById(databaseId, entry.id);
        const first = matches[0] ?? null;
        const decision = decideUpsert(entry, first);
        if (decision === 'unchanged') unchanged += 1;
        else {
          await write(first?.pageId ?? null, databaseId, entry, false);
          if (decision === 'create') created += 1;
          else updated += 1;
        }
        for (const extra of matches.slice(1)) {
          await notion(`/pages/${extra.pageId}`, {
            method: 'PATCH',
            body: { properties: { アーカイブ: { checkbox: true } } },
          });
        }
      }
      return { created, updated, unchanged };
    },
    async archive(databaseId, liveIds, cursor, pending) {
      const live = new Set(liveIds);
      if (pending.length > 0) {
        const batch = pending.slice(0, 12);
        for (const item of batch) {
          await notion(`/pages/${item.pageId}`, {
            method: 'PATCH',
            body: { properties: { アーカイブ: { checkbox: true } } },
          });
        }
        return { archived: batch.length, pending: pending.slice(12), nextCursor: cursor };
      }
      const body = (await notion(`/databases/${databaseId}/query`, {
        method: 'POST',
        body: {
          filter: { property: 'アーカイブ', checkbox: { equals: false } },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        },
      })) as {
        results?: Record<string, unknown>[];
        has_more?: boolean;
        next_cursor?: string | null;
      };
      const todo: ArchiveItem[] = [];
      for (const page of body.results ?? []) {
        const properties = page.properties as Record<string, unknown> | undefined;
        const dajareId = plain(properties?.id);
        const archived = Boolean(
          (properties?.アーカイブ as { checkbox?: boolean } | undefined)?.checkbox,
        );
        if (
          decideArchive(dajareId || null, archived, live) !== 'archive' ||
          typeof page.id !== 'string'
        )
          continue;
        todo.push({ pageId: page.id, dajareId });
      }
      const batch = todo.slice(0, 12);
      for (const item of batch) {
        await notion(`/pages/${item.pageId}`, {
          method: 'PATCH',
          body: { properties: { アーカイブ: { checkbox: true } } },
        });
      }
      const more = todo.slice(12);
      return {
        archived: batch.length,
        pending: more,
        nextCursor: more.length > 0 ? cursor : body.has_more ? (body.next_cursor ?? null) : null,
      };
    },
    async finish(databaseId, at) {
      await notion(`/databases/${databaseId}`, {
        method: 'PATCH',
        body: {
          description: [{ type: 'text', text: { content: `最終保管 ${at}` } }],
        },
      });
      return { lastBackupAt: at };
    },
  };
}
