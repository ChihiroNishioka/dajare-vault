// Worker（handleNotionBackup と createNotionClient）が返す notionUrl を、偽の Notion で確かめる。
import { describe, expect, it } from 'vitest';
import { handleNotionBackup } from '../src/notion/handler';
import { createNotionClient, type NotionRelay } from '../src/notion/notion-api';
import { RetryLater } from '../src/notion/throttle';

const ORIGIN = 'https://chihironishioka.github.io';
const PAGE_ID = 'a'.repeat(32);
const NOTION_SECRET = ['notion', 'placeholder', 'value'].join('-');
const ID_TOKEN = ['firebase', 'id', 'placeholder'].join('-');
const EMAIL = ['editor', 'example.com'].join('@');
const FOUND_DB = '0123ABCD-89AB-CDEF-0123-456789ABCDEF';
const FOUND_URL = 'https://www.notion.so/0123abcd89abcdef0123456789abcdef';
const PROPERTIES = Object.fromEntries(
  [
    '本文',
    '全文',
    'id',
    '場面',
    '読み',
    '出典',
    'メモ',
    '追加日',
    '追加日メモ',
    '評価',
    'お気に入り',
    'タグ',
    '言った人',
    '作成',
    '更新',
    '書いた人',
    '直した人',
    '照合',
    'アーカイブ',
  ].map((key) => [key, {}]),
);

function fakeNotion(databaseId: string, seen: string[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const path = String(url).replace('https://api.notion.com/v1', '');
    seen.push(`${init?.method ?? 'GET'} ${path}`);
    if (path.startsWith('/blocks/')) {
      return Response.json({
        results: [{ id: databaseId, type: 'child_database', child_database: { title: '駄洒落' } }],
        has_more: false,
      });
    }
    if (path.startsWith('/databases/') && (init?.method ?? 'GET') === 'GET') {
      return Response.json({
        id: databaseId,
        url: 'https://evil.example/0123abcd89abcdef0123456789abcdef',
        public_url: 'https://evil.example/public',
        properties: PROPERTIES,
      });
    }
    return Response.json({
      id: databaseId,
      url: 'https://evil.example/0123abcd89abcdef0123456789abcdef',
    });
  }) as typeof fetch;
}

function client(databaseId: string, seen: string[] = []): NotionRelay {
  return createNotionClient({
    token: NOTION_SECRET,
    pageId: PAGE_ID,
    fetchImpl: fakeNotion(databaseId, seen),
    sleep: async () => undefined,
    intervalMs: 0,
  });
}

function call(
  body: unknown,
  notion: NotionRelay,
  overrides: Partial<Parameters<typeof handleNotionBackup>[1]> = {},
  init: { method?: string; auth?: string | null; origin?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    origin: init.origin ?? ORIGIN,
    'content-type': 'application/json',
  };
  if (init.auth !== null) headers.authorization = init.auth ?? `Bearer ${ID_TOKEN}`;
  return handleNotionBackup(
    new Request('https://relay.example/notion-backup', {
      method: init.method ?? 'POST',
      headers,
      body:
        init.method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    {
      nowSec: () => Date.UTC(2026, 10, 8, 0, 4) / 1000,
      verifyToken: async () => ({ email: EMAIL, uid: 'u' }),
      confirmEditor: async () => true,
      notion,
      ...overrides,
    },
  );
}

describe('relay notionUrl', () => {
  it('finish returns www.notion.so with the found database id in 32 lowercase hex digits', async () => {
    const response = await call({ op: 'finish' }, client(FOUND_DB));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      lastBackupAt: '2026-11-08T00:04:00.000Z',
      notionUrl: FOUND_URL,
    });
  });

  it('ignores the url that Notion itself returns', async () => {
    const notion = client(FOUND_DB);
    await notion.ensure();
    const done = await notion.finish('2026-11-08T00:04:00.000Z');
    expect(done.notionUrl).toBe(FOUND_URL);
    expect(JSON.stringify(done)).not.toContain('evil.example');
  });

  it('builds the url from the database it found, not from ids in the request', async () => {
    const seen: string[] = [];
    const response = await call(
      { op: 'finish', databaseId: 'c'.repeat(32), pageId: 'd'.repeat(32) },
      client(FOUND_DB, seen),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { notionUrl: string };
    expect(body.notionUrl).toBe(FOUND_URL);
    expect(
      seen.some((line) => line.includes('c'.repeat(32)) || line.includes('d'.repeat(32))),
    ).toBe(false);
  });

  it('returns 200 with notionUrl null and lastBackupAt when the id or url is not safe', async () => {
    for (const notionUrl of [
      null,
      'https://evil.example/0123abcd89abcdef0123456789abcdef',
      'javascript:alert(1)',
      'http://www.notion.so/0123abcd89abcdef0123456789abcdef',
    ]) {
      const notion = {
        finish: async (at: string) => ({ lastBackupAt: at, notionUrl }),
      } as unknown as NotionRelay;
      const response = await call({ op: 'finish' }, notion);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        lastBackupAt: '2026-11-08T00:04:00.000Z',
        notionUrl: null,
      });
    }
  });

  it('leaves notionUrl out of every error and retry response', async () => {
    const finishOk = client(FOUND_DB);
    const failing = {
      finish: async () => {
        throw new Error('Notionが混み合っています');
      },
    } as unknown as NotionRelay;
    const later = {
      finish: async () => {
        throw new RetryLater(1500);
      },
    } as unknown as NotionRelay;
    const responses: [number, Response][] = [
      [400, await call('{', finishOk)],
      [400, await call({ op: 'finish', databaseId: '..' }, finishOk)],
      [401, await call({ op: 'finish' }, finishOk, {}, { auth: null })],
      [
        401,
        await call({ op: 'finish' }, finishOk, {
          verifyToken: async () => {
            throw new Error('bad');
          },
        }),
      ],
      [403, await call({ op: 'finish' }, finishOk, { confirmEditor: async () => false })],
      [403, await call({ op: 'finish' }, finishOk, {}, { origin: 'https://evil.example' })],
      [405, await call(null, finishOk, {}, { method: 'GET' })],
      [502, await call({ op: 'finish' }, failing)],
      [
        503,
        await call({ op: 'finish' }, finishOk, {
          confirmEditor: async () => {
            throw new Error('編集者の確認ができませんでした');
          },
        }),
      ],
      [200, await call({ op: 'finish' }, later)],
    ];
    for (const [status, response] of responses) {
      expect(response.status).toBe(status);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body, String(status)).not.toHaveProperty('notionUrl');
    }
    const worker = (await import('../relay/src/index')).default;
    const missing = await worker.fetch(
      new Request('https://relay.example/notion-backup', {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'finish' }),
      }),
      {},
    );
    expect(missing.status).toBe(500);
    expect(await missing.json()).not.toHaveProperty('notionUrl');
  });

  it('keeps the Notion secret, the id token and the email out of the finish response', async () => {
    const response = await call({ op: 'finish' }, client(FOUND_DB));
    const text = await response.text();
    expect(text).toContain('notionUrl');
    expect(text).not.toContain(NOTION_SECRET);
    expect(text).not.toContain(ID_TOKEN);
    expect(text).not.toContain(EMAIL);
  });
});
