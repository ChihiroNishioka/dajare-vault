import {
  archiveNeedsConfirm,
  decideArchive,
  decideUpsert,
  entryFingerprint,
  isNotionId,
  type NotionDajare,
  type NotionMatch,
} from './plan';
import {
  BudgetStop,
  createLimiter,
  MAX_INLINE_WAIT_MS,
  NOTION_MIN_INTERVAL_MS,
  RetryLater,
  retryDelayMs,
  SubrequestBudget,
} from './throttle';

const NOTION_VERSION = '2022-06-28';
const DATABASE_TITLE = '駄洒落';

export interface ArchiveItem {
  pageId: string;
  dajareId: string;
}

export interface ArchivePass {
  archived: number;
  nextCursor: string | null;
  done: boolean;
  needConfirm?: boolean;
  wouldArchive?: number;
  existing?: number;
  counting?: boolean;
}

export interface UpsertTally {
  created: number;
  updated: number;
  unchanged: number;
  resumeFrom?: number;
}

export interface NotionRelay {
  ensure(): Promise<{ databaseId: string; lastBackupAt: string | null }>;
  upsert(entries: NotionDajare[]): Promise<UpsertTally>;
  archive(liveIds: string[], cursor: string | null, confirm: boolean): Promise<ArchivePass>;
  finish(at: string): Promise<{ lastBackupAt: string }>;
}

function richText(value: string): { rich_text: { type: 'text'; text: { content: string } }[] } {
  if (!value) return { rich_text: [] };
  return { rich_text: [{ type: 'text', text: { content: value.slice(0, 2000) } }] };
}

function titleOf(text: string): { title: { type: 'text'; text: { content: string } }[] } {
  const oneLine = text.replace(/\s+/g, ' ').trim() || '（空）';
  return { title: [{ type: 'text', text: { content: oneLine.slice(0, 2000) } }] };
}

function encodeCountCursor(notion: string | null, existing: number, orphans: number): string {
  return `count.${btoa(JSON.stringify({ c: notion, e: existing, o: orphans }))}`;
}

function decodeCountCursor(
  cursor: string | null,
): { notion: string | null; existing: number; orphans: number } | null {
  if (!cursor?.startsWith('count.')) return null;
  try {
    const parsed = JSON.parse(atob(cursor.slice('count.'.length))) as {
      c?: unknown;
      e?: unknown;
      o?: unknown;
    };
    return {
      notion: typeof parsed.c === 'string' && parsed.c ? parsed.c : null,
      existing: typeof parsed.e === 'number' && parsed.e > 0 ? parsed.e : 0,
      orphans: typeof parsed.o === 'number' && parsed.o > 0 ? parsed.o : 0,
    };
  } catch {
    return null;
  }
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

function propertiesOf(entry: NotionDajare, archived: boolean, hash: string) {
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
    照合: richText(hash),
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
  budget?: SubrequestBudget;
}): NotionRelay {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const limit = createLimiter(options.intervalMs ?? NOTION_MIN_INTERVAL_MS, sleep);
  const budget = options.budget ?? new SubrequestBudget();
  let pinnedDatabaseId: string | null = null;

  async function notion(
    path: string,
    init: { method: string; body?: unknown },
    kind: 'read' | 'write',
    attempt = 0,
  ): Promise<unknown> {
    if (path.includes('..')) throw new Error('依頼の形が違います');
    budget.take();
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
    if (response.status === 429 || response.status === 529) {
      const wait = retryDelayMs(attempt, response.headers.get('retry-after'));
      if (wait > MAX_INLINE_WAIT_MS || attempt >= 4) throw new RetryLater(wait);
      await sleep(wait);
      return notion(path, init, kind, attempt + 1);
    }
    if (response.status >= 500) {
      if (kind === 'read' && attempt < 4) {
        await sleep(retryDelayMs(attempt, null));
        return notion(path, init, kind, attempt + 1);
      }
      throw new Error('Notionへの保管に失敗しました');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('Notionのトークンが拒否されました');
    }
    if (response.status === 404) throw new Error('Notionのページが統合に共有されていません');
    if (!response.ok) throw new Error('Notionへの保管に失敗しました');
    return response.json();
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

  function requireId(value: string): string {
    if (!isNotionId(value)) throw new Error('依頼の形が違います');
    return value;
  }

  async function findById(databaseId: string, id: string): Promise<NotionMatch[]> {
    const body = (await notion(
      `/databases/${requireId(databaseId)}/query`,
      {
        method: 'POST',
        body: {
          filter: { property: 'id', rich_text: { equals: id } },
          sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
          page_size: 5,
        },
      },
      'read',
    )) as { results?: Record<string, unknown>[] };
    return (body.results ?? []).map(matchOf).filter((row): row is NotionMatch => row !== null);
  }

  async function write(
    pageId: string | null,
    databaseId: string,
    entry: NotionDajare,
    archived: boolean,
  ) {
    const hash = await entryFingerprint(entry);
    const properties = propertiesOf(entry, archived, hash);
    if (pageId) {
      await notion(
        `/pages/${requireId(pageId)}`,
        { method: 'PATCH', body: { properties } },
        'write',
      );
      return hash;
    }
    try {
      await notion(
        '/pages',
        { method: 'POST', body: { parent: { database_id: requireId(databaseId) }, properties } },
        'write',
      );
    } catch (error) {
      if (error instanceof RetryLater || error instanceof BudgetStop) throw error;
      const again = await findById(databaseId, entry.id);
      if (again.length === 0) throw error;
    }
    return hash;
  }

  async function ensureDatabase(): Promise<{ databaseId: string; lastBackupAt: string | null }> {
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const query = cursor
        ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}`
        : '?page_size=100';
      const body = (await notion(
        `/blocks/${requireId(options.pageId)}/children${query}`,
        { method: 'GET' },
        'read',
      )) as {
        results?: { id?: string; type?: string; child_database?: { title?: string } }[];
        has_more?: boolean;
        next_cursor?: string | null;
      };
      for (const block of body.results ?? []) {
        if (block.type !== 'child_database' || !block.id) continue;
        if (block.child_database?.title && block.child_database.title !== DATABASE_TITLE) continue;
        if (!isNotionId(block.id)) continue;
        const database = (await notion(`/databases/${block.id}`, { method: 'GET' }, 'read')) as {
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
          await notion(
            `/databases/${requireId(database.id)}`,
            { method: 'PATCH', body: { properties: missing } },
            'write',
          );
        }
        pinnedDatabaseId = database.id;
        return { databaseId: database.id, lastBackupAt: lastBackupFrom(database.description) };
      }
      if (!body.has_more || !body.next_cursor) break;
      cursor = body.next_cursor;
    }
    const created = (await notion(
      '/databases',
      {
        method: 'POST',
        body: {
          parent: { type: 'page_id', page_id: requireId(options.pageId) },
          title: [{ type: 'text', text: { content: DATABASE_TITLE } }],
          properties: DATABASE_PROPERTIES,
        },
      },
      'write',
    )) as { id: string };
    if (!isNotionId(created.id)) throw new Error('Notionのデータベースを用意できませんでした');
    pinnedDatabaseId = created.id;
    return { databaseId: created.id, lastBackupAt: null };
  }

  async function pin(): Promise<string> {
    if (pinnedDatabaseId && isNotionId(pinnedDatabaseId)) return pinnedDatabaseId;
    const found = await ensureDatabase();
    return found.databaseId;
  }

  async function queryPage(databaseId: string, pageCursor: string | null) {
    return (await notion(
      `/databases/${requireId(databaseId)}/query`,
      {
        method: 'POST',
        body: {
          filter: { property: 'アーカイブ', checkbox: { equals: false } },
          page_size: 100,
          ...(pageCursor ? { start_cursor: pageCursor } : {}),
        },
      },
      'read',
    )) as {
      results?: Record<string, unknown>[];
      has_more?: boolean;
      next_cursor?: string | null;
    };
  }

  async function countOrphans(
    databaseId: string,
    live: Set<string>,
    pageCursor: string | null,
    existing: number,
    orphans: number,
  ) {
    let current = pageCursor;
    try {
      for (;;) {
        const page = await queryPage(databaseId, current);
        for (const row of page.results ?? []) {
          existing += 1;
          const properties = row.properties as Record<string, unknown> | undefined;
          const dajareId = plain(properties?.id);
          const archived = Boolean(
            (properties?.アーカイブ as { checkbox?: boolean } | undefined)?.checkbox,
          );
          if (decideArchive(dajareId || null, archived, live) === 'archive') orphans += 1;
        }
        if (!page.has_more || !page.next_cursor) {
          return { existing, orphans, done: true as const, cursor: null };
        }
        current = page.next_cursor;
      }
    } catch (error) {
      if (error instanceof BudgetStop) {
        return { existing, orphans, done: false as const, cursor: current };
      }
      throw error;
    }
  }

  return {
    ensure: ensureDatabase,
    async upsert(entries) {
      const databaseId = await pin();
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!entry) continue;
        try {
          const hash = await entryFingerprint(entry);
          const matches = await findById(databaseId, entry.id);
          const first = matches[0] ?? null;
          const decision = decideUpsert(hash, first);
          if (decision === 'unchanged') unchanged += 1;
          else {
            await write(first?.pageId ?? null, databaseId, entry, false);
            if (decision === 'create') created += 1;
            else updated += 1;
          }
          for (const extra of matches.slice(1)) {
            if (extra.archived || !isNotionId(extra.pageId)) continue;
            await notion(
              `/pages/${extra.pageId}`,
              { method: 'PATCH', body: { properties: { アーカイブ: { checkbox: true } } } },
              'write',
            );
          }
        } catch (error) {
          if (error instanceof BudgetStop) {
            return { created, updated, unchanged, resumeFrom: index };
          }
          throw error;
        }
      }
      return { created, updated, unchanged };
    },
    async archive(liveIds, cursor, confirm) {
      const databaseId = await pin();
      const live = new Set(liveIds);
      const counted = decodeCountCursor(cursor);
      let current: string | null;
      if (!confirm) {
        const tally = await countOrphans(
          databaseId,
          live,
          counted?.notion ?? null,
          counted?.existing ?? 0,
          counted?.orphans ?? 0,
        );
        if (!tally.done) {
          return {
            archived: 0,
            nextCursor: encodeCountCursor(tally.cursor, tally.existing, tally.orphans),
            done: false,
            counting: true,
          };
        }
        if (archiveNeedsConfirm(tally.orphans, tally.existing)) {
          return {
            archived: 0,
            nextCursor: null,
            done: false,
            needConfirm: true,
            wouldArchive: tally.orphans,
            existing: tally.existing,
          };
        }
        current = null;
      } else {
        current = counted ? null : cursor;
      }
      let archived = 0;
      try {
        for (;;) {
          const page = await queryPage(databaseId, current);
          let unfinished = false;
          for (const row of page.results ?? []) {
            const properties = row.properties as Record<string, unknown> | undefined;
            const dajareId = plain(properties?.id);
            const already = Boolean(
              (properties?.アーカイブ as { checkbox?: boolean } | undefined)?.checkbox,
            );
            if (
              decideArchive(dajareId || null, already, live) !== 'archive' ||
              typeof row.id !== 'string' ||
              !isNotionId(row.id)
            ) {
              continue;
            }
            try {
              await notion(
                `/pages/${row.id}`,
                { method: 'PATCH', body: { properties: { アーカイブ: { checkbox: true } } } },
                'write',
              );
              archived += 1;
            } catch (error) {
              if (error instanceof BudgetStop) {
                unfinished = true;
                break;
              }
              throw error;
            }
          }
          if (unfinished) return { archived, nextCursor: current, done: false };
          if (!page.has_more || !page.next_cursor)
            return { archived, nextCursor: null, done: true };
          current = page.next_cursor;
        }
      } catch (error) {
        if (error instanceof BudgetStop) return { archived, nextCursor: current, done: false };
        throw error;
      }
    },
    async finish(at) {
      const databaseId = await pin();
      await notion(
        `/databases/${requireId(databaseId)}`,
        {
          method: 'PATCH',
          body: { description: [{ type: 'text', text: { content: `最終保管 ${at}` } }] },
        },
        'write',
      );
      return { lastBackupAt: at };
    },
  };
}
