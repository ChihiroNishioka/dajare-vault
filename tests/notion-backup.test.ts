import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign as signBuffer, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadSecureTokenKey,
  pemToDer,
  readFirebaseClaims,
  resetCertCache,
  spkiFromCertificate,
  verifyFirebaseIdToken,
} from '../src/notion/claims';
import { backupCors } from '../src/notion/cors';
import { runNotionBackup, UPSERT_CHUNK } from '../src/notion/client';
import { confirmEditor } from '../src/notion/editors';
import { handleNotionBackup } from '../src/notion/handler';
import { notionSuccessMessage } from '../src/notion/messages';
import { createNotionClient } from '../src/notion/notion-api';
import {
  archiveNeedsConfirm,
  backupBlockReason,
  decideArchive,
  decideUpsert,
  dedupeEntries,
  entryFingerprint,
  type NotionDajare,
} from '../src/notion/plan';
import { SubrequestBudget } from '../src/notion/throttle';
import { createLimiter, retryDelayMs } from '../src/notion/throttle';

const entry = (id: string, text = '布団がふっとんだ'): NotionDajare => ({
  id,
  text,
  scene: '朝',
  addedAt: '2026-10-02',
  addedAtNote: '',
  reading: '',
  source: '',
  rating: 3,
  favorite: false,
  tags: ['朝'],
  speakers: [],
  memo: '',
  updatedAt: '2026-10-02T00:00:00Z',
  createdByName: 'まひろ',
});

function token(
  payload: Record<string, unknown>,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  kid = 'kid-1',
) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signBuffer('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString(
    'base64url',
  );
  return `${header}.${body}.${signature}`;
}

describe('notion upsert and archive', () => {
  it('creates, updates, restores, or skips without a second row', async () => {
    const item = entry('id-1');
    const hash = await entryFingerprint(item);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(decideUpsert(hash, null)).toBe('create');
    const match = { pageId: 'c'.repeat(32), fingerprint: hash, archived: false };
    expect(decideUpsert(hash, match)).toBe('unchanged');
    expect(decideUpsert(await entryFingerprint({ ...item, text: '直した' }), match)).toBe('update');
    expect(decideUpsert(hash, { ...match, archived: true })).toBe('restore');
    expect(dedupeEntries([item, { ...item, text: 'あと' }])).toEqual([{ ...item, text: 'あと' }]);
    expect(
      (await entryFingerprint({ ...item, text: 'あ'.repeat(1500), memo: 'い'.repeat(800) })).length,
    ).toBe(64);
  });

  it('archives rows whose id left the vault and keeps the page', () => {
    const live = new Set(['keep']);
    expect(decideArchive('gone', false, live)).toBe('archive');
    expect(decideArchive('keep', false, live)).toBe('skip');
    expect(decideArchive('gone', true, live)).toBe('skip');
    expect(decideArchive(null, false, live)).toBe('skip');
  });
});

describe('notion throttle', () => {
  it('waits out the gap and honors Retry-After', async () => {
    let clock = 0;
    const waits: number[] = [];
    const limit = createLimiter(
      100,
      async (ms) => {
        waits.push(ms);
        clock += ms;
      },
      () => clock,
    );
    await limit();
    await limit();
    await limit();
    expect(waits).toEqual([100, 100]);
    expect(retryDelayMs(0, null)).toBe(400);
    expect(retryDelayMs(0, '2')).toBe(2000);
    expect(retryDelayMs(1, '99')).toBe(60_000);
  });
});

describe('firebase token and editors', () => {
  const projectId = 'dajare-vault';
  const now = 1_700_000_000;

  it('rejects a bad audience, issuer, expiry, or unverified email', () => {
    const base = {
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      exp: now + 60,
      iat: now - 10,
      auth_time: now - 10,
      email_verified: true,
      email: 'editor@example.com',
      sub: 'uid-1',
      user_id: 'uid-1',
      firebase: { sign_in_provider: 'google.com' },
    };
    expect(readFirebaseClaims(base, now, projectId)).toEqual({
      email: 'editor@example.com',
      uid: 'uid-1',
    });
    expect(() => readFirebaseClaims({ ...base, aud: 'other' }, now, projectId)).toThrow(/相手/);
    expect(() =>
      readFirebaseClaims({ ...base, iss: 'https://example.invalid' }, now, projectId),
    ).toThrow(/発行元/);
    expect(() => readFirebaseClaims({ ...base, exp: now }, now, projectId)).toThrow(/期限/);
    expect(() => readFirebaseClaims({ ...base, email_verified: false }, now, projectId)).toThrow(
      /確認/,
    );
    expect(() => readFirebaseClaims({ ...base, iat: now + 600 }, now, projectId)).toThrow(/時刻/);
    expect(() => readFirebaseClaims({ ...base, auth_time: now + 600 }, now, projectId)).toThrow(
      /時刻/,
    );
    expect(() => readFirebaseClaims({ ...base, sub: '' }, now, projectId)).toThrow(/uid/);
    expect(() => readFirebaseClaims({ ...base, user_id: 'other' }, now, projectId)).toThrow(/uid/);
    expect(() =>
      readFirebaseClaims({ ...base, firebase: { sign_in_provider: 'password' } }, now, projectId),
    ).toThrow(/Google/);
  });

  it('checks the signature against the certificate key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dajare-cert-'));
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem'),
        '-days',
        '1',
        '-nodes',
        '-subj',
        '/CN=test',
      ],
      { stdio: 'pipe' },
    );
    const certPem = readFileSync(join(dir, 'cert.pem'), 'utf8');
    const expected = new X509Certificate(certPem).publicKey.export({ type: 'spki', format: 'der' });
    expect(Buffer.from(spkiFromCertificate(pemToDer(certPem)))).toEqual(Buffer.from(expected));
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const spki = publicKey.export({ type: 'spki', format: 'der' });
    const key = await crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const jwt = token(
      {
        aud: projectId,
        iss: `https://securetoken.google.com/${projectId}`,
        exp: now + 60,
        email_verified: true,
        email: 'Editor@Example.com',
        sub: 'uid-1',
        user_id: 'uid-1',
        iat: now - 10,
        auth_time: now - 10,
        firebase: { sign_in_provider: 'google.com' },
      },
      privateKey,
    );
    await expect(
      verifyFirebaseIdToken(jwt, { projectId, nowSec: now, getKey: async () => key }),
    ).resolves.toEqual({
      email: 'editor@example.com',
      uid: 'uid-1',
    });
    await expect(
      verifyFirebaseIdToken(`${jwt}x`, { projectId, nowSec: now, getKey: async () => key }),
    ).rejects.toThrow(/署名/);
  });

  it('allows only an editors document that exists', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response('{}', { status: url.includes('missing') ? 404 : 200 });
    }) as typeof fetch;
    await expect(
      confirmEditor('dajare-vault', 'editor@example.com', 'tok', fetchImpl),
    ).resolves.toBe(true);
    await expect(
      confirmEditor('dajare-vault', 'missing@example.com', 'tok', fetchImpl),
    ).resolves.toBe(false);
    expect(calls[0]).toContain('/editors/editor%40example.com');
    expect(calls[0]).not.toContain('chihiro');
  });
});

describe('notion relay gate', () => {
  const origin = 'https://chihironishioka.github.io';

  it('rejects other origins and non-editors', async () => {
    expect(backupCors('https://example.invalid')).toBeNull();
    expect(backupCors(origin)?.['access-control-allow-origin']).toBe(origin);
    const request = new Request('https://relay.example/notion-backup', {
      method: 'POST',
      headers: { origin, authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'ensure' }),
    });
    const denied = await handleNotionBackup(request, {
      nowSec: () => 0,
      verifyToken: async () => ({ email: 'person@example.com', uid: 'u' }),
      confirmEditor: async () => false,
      notion: {} as never,
    });
    expect(denied.status).toBe(403);
    const foreign = await handleNotionBackup(
      new Request('https://relay.example/notion-backup', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      }),
      {
        nowSec: () => 0,
        verifyToken: async () => {
          throw new Error('no');
        },
        confirmEditor: async () => true,
        notion: {} as never,
      },
    );
    expect(foreign.status).toBe(403);
  });

  it('upserts through Notion without a second page when the id exists', async () => {
    const item = entry('id-1');
    const pageId = 'a'.repeat(32);
    const databaseId = 'b'.repeat(32);
    const rowId = 'c'.repeat(32);
    const hash = await entryFingerprint(item);
    const calls: { path: string; body?: unknown }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = String(url).replace('https://api.notion.com/v1', '');
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      if (path.startsWith('/blocks/')) return Response.json({ results: [], has_more: false });
      if (path === '/databases' && init?.method === 'POST')
        return Response.json({ id: databaseId });
      if (path.endsWith('/query') && body?.filter) {
        return Response.json({
          results: calls.filter((call) => call.path === '/pages').length
            ? [
                {
                  id: rowId,
                  properties: {
                    id: { rich_text: [{ plain_text: 'id-1' }] },
                    照合: { rich_text: [{ plain_text: hash }] },
                    アーカイブ: { checkbox: false },
                  },
                },
              ]
            : [],
          has_more: false,
        });
      }
      if (path === '/pages') return Response.json({ id: rowId });
      return Response.json({});
    }) as typeof fetch;
    const notionCredential = ['notion', 'placeholder'].join('-');
    const notion = createNotionClient({
      token: notionCredential,
      pageId,
      fetchImpl,
      sleep: async () => undefined,
      intervalMs: 0,
    });
    await expect(notion.ensure()).resolves.toEqual({ databaseId, lastBackupAt: null });
    await expect(notion.upsert([item])).resolves.toEqual({ created: 1, updated: 0, unchanged: 0 });
    await expect(notion.upsert([item])).resolves.toEqual({ created: 0, updated: 0, unchanged: 1 });
    expect(calls.filter((call) => call.path === '/pages')).toHaveLength(1);
    const archived = await notion.archive(['other-id'], null, true);
    expect(archived.archived).toBe(1);
    expect(archived.done).toBe(true);
  });
});

describe('backup client', () => {
  it('chunks the vault and totals the relay counts', async () => {
    const ops: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { op: string; entries?: unknown[] };
      ops.push(body.op);
      if (body.op === 'ensure') return Response.json({ databaseId: 'db-1', lastBackupAt: null });
      if (body.op === 'upsert') {
        return Response.json({ created: body.entries?.length ?? 0, updated: 0, unchanged: 0 });
      }
      if (body.op === 'archive')
        return Response.json({ archived: 3, done: true, nextCursor: null });
      return Response.json({ lastBackupAt: '2026-10-31T03:00:00.000Z' });
    }) as typeof fetch;
    const entries = Array.from({ length: UPSERT_CHUNK + 1 }, (_, index) => entry(`id-${index}`));
    const progress: number[] = [];
    const result = await runNotionBackup({
      relayUrl: 'https://notion-backup.test/notion-backup',
      token: ['browser', 'placeholder'].join('-'),
      entries,
      fetchImpl,
      onProgress: (state) => progress.push(state.done),
    });
    expect(ops.filter((op) => op === 'upsert')).toHaveLength(2);
    expect(result).toMatchObject({ created: UPSERT_CHUNK + 1, archived: 3 });
    expect(progress.at(-1)).toBe(UPSERT_CHUNK + 1);
    expect(notionSuccessMessage(result)).toContain('しまって 3 件');
  });

  it('rejects an empty vault before archiving', async () => {
    await expect(
      runNotionBackup({
        relayUrl: 'https://notion-backup.test/notion-backup',
        token: ['browser', 'placeholder'].join('-'),
        entries: [],
        fetchImpl: (async () => {
          throw new Error('called');
        }) as typeof fetch,
      }),
    ).rejects.toThrow(/紙がありません/);
    const origin = 'https://chihironishioka.github.io';
    const response = await handleNotionBackup(
      new Request('https://relay.example/notion-backup', {
        method: 'POST',
        headers: { origin, authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'archive', liveIds: [] }),
      }),
      {
        nowSec: () => 0,
        verifyToken: async () => ({ email: 'editor@example.com', uid: 'u' }),
        confirmEditor: async () => true,
        notion: {
          archive: async () => {
            throw new Error('no');
          },
        } as never,
      },
    );
    expect(response.status).toBe(400);
  });

  it('retries a zero resume and does not finish a stuck archive', async () => {
    let upserts = 0;
    let finishes = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { op: string };
      if (body.op === 'ensure') return Response.json({ databaseId: 'db-1', lastBackupAt: null });
      if (body.op === 'upsert') {
        upserts += 1;
        if (upserts === 1) {
          return Response.json({ created: 0, updated: 0, unchanged: 0, resumeFrom: 0 });
        }
        return Response.json({ created: 1, updated: 0, unchanged: 0 });
      }
      if (body.op === 'finish') {
        finishes += 1;
        return Response.json({ lastBackupAt: '2026-10-31T03:00:00.000Z' });
      }
      return Response.json({ archived: 0, done: false, nextCursor: 'again' });
    }) as typeof fetch;
    await expect(
      runNotionBackup({
        relayUrl: 'https://notion-backup.test/notion-backup',
        token: ['browser', 'placeholder'].join('-'),
        entries: [entry('id-1')],
        fetchImpl,
      }),
    ).rejects.toThrow(/終わりません/);
    expect(finishes).toBe(0);
    expect(upserts).toBe(2);
  });

  it('rejects a database id that is not a Notion id', async () => {
    const origin = 'https://chihironishioka.github.io';
    const response = await handleNotionBackup(
      new Request('https://relay.example/notion-backup', {
        method: 'POST',
        headers: { origin, authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'ensure', databaseId: '..', pageId: '../secret' }),
      }),
      {
        nowSec: () => 0,
        verifyToken: async () => ({ email: 'editor@example.com', uid: 'u' }),
        confirmEditor: async () => true,
        notion: {
          ensure: async () => {
            throw new Error('no');
          },
        } as never,
      },
    );
    expect(response.status).toBe(400);
    let pinned = '';
    const ignored = await handleNotionBackup(
      new Request('https://relay.example/notion-backup', {
        method: 'POST',
        headers: { origin, authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'ensure', databaseId: 'a'.repeat(32) }),
      }),
      {
        nowSec: () => 0,
        verifyToken: async () => ({ email: 'editor@example.com', uid: 'u' }),
        confirmEditor: async () => true,
        notion: {
          ensure: async () => {
            pinned = 'b'.repeat(32);
            return { databaseId: pinned, lastBackupAt: null };
          },
        } as never,
      },
    );
    expect(ignored.status).toBe(200);
    expect(pinned).toBe('b'.repeat(32));
  });
});

describe('backup guards', () => {
  it('blocks a partial cloud load and an empty list', () => {
    expect(
      backupBlockReason({ mode: 'cloud', serverReady: false, readError: null, count: 10 }),
    ).toBe('loading');
    expect(backupBlockReason({ mode: 'cloud', serverReady: true, readError: null, count: 0 })).toBe(
      'empty',
    );
    expect(
      backupBlockReason({ mode: 'cloud', serverReady: true, readError: '読めない', count: 3 }),
    ).toBe('error');
    expect(backupBlockReason({ mode: 'local', serverReady: true, readError: null, count: 2 })).toBe(
      null,
    );
    expect(archiveNeedsConfirm(100, 119)).toBe(true);
    expect(archiveNeedsConfirm(5, 119)).toBe(false);
  });

  it('walks every page when archiving 119 rows', async () => {
    const rows = Array.from({ length: 119 }, (_, index) => ({
      id: index.toString(16).padStart(32, 'a'),
      dajareId: `row-${index}`,
      archived: false,
    }));
    const patches: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (path.includes('/blocks/')) return Response.json({ results: [], has_more: false });
      if (path.endsWith('/databases') && init?.method === 'POST') {
        return Response.json({ id: 'b'.repeat(32) });
      }
      if (path.includes('/query')) {
        const start = body.start_cursor ? Number(body.start_cursor) : 0;
        const slice = rows.slice(start, start + 100).filter((row) => !row.archived);
        const next = start + 100 < rows.length ? String(start + 100) : null;
        return Response.json({
          results: slice.map((row) => ({
            id: row.id,
            properties: {
              id: { rich_text: [{ plain_text: row.dajareId }] },
              アーカイブ: { checkbox: false },
            },
          })),
          has_more: next !== null,
          next_cursor: next,
        });
      }
      if (path.includes('/pages/') && init?.method === 'PATCH') {
        const id = path.split('/pages/')[1];
        const row = rows.find((item) => item.id === id);
        if (row) row.archived = true;
        patches.push(id ?? '');
        return Response.json({});
      }
      return Response.json({});
    }) as typeof fetch;
    const notion = createNotionClient({
      token: ['notion', 'placeholder'].join('-'),
      pageId: 'd'.repeat(32),
      fetchImpl,
      sleep: async () => undefined,
      intervalMs: 0,
      budget: new SubrequestBudget(500),
    });
    await notion.ensure();
    let cursor: string | null = null;
    let archived = 0;
    let guard = 0;
    while (guard < 20) {
      const pass = await notion.archive(['still-here'], cursor, true);
      archived += pass.archived;
      if (pass.done) break;
      cursor = pass.nextCursor;
      guard += 1;
    }
    expect(archived).toBe(119);
    expect(patches).toHaveLength(119);
  });

  it('stops before 50 subrequests and resumes', async () => {
    const queries: number[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.includes('/blocks/')) return Response.json({ results: [], has_more: false });
      if (path.endsWith('/databases') && init?.method === 'POST') {
        return Response.json({ id: 'b'.repeat(32) });
      }
      if (path.includes('/query')) {
        queries.push(1);
        const id = queries.length.toString(16).padStart(32, 'c');
        return Response.json({
          results: [
            {
              id,
              properties: {
                id: { rich_text: [{ plain_text: 'missing' }] },
                照合: { rich_text: [{ plain_text: 'other' }] },
                アーカイブ: { checkbox: false },
              },
            },
            {
              id: id.replace(/c/g, 'd'),
              properties: {
                id: { rich_text: [{ plain_text: 'missing' }] },
                照合: { rich_text: [{ plain_text: 'other' }] },
                アーカイブ: { checkbox: false },
              },
            },
          ],
          has_more: false,
        });
      }
      return Response.json({});
    }) as typeof fetch;
    const notion = createNotionClient({
      token: ['notion', 'placeholder'].join('-'),
      pageId: 'd'.repeat(32),
      fetchImpl,
      sleep: async () => undefined,
      intervalMs: 0,
      budget: new SubrequestBudget(6),
    });
    await notion.ensure();
    const items = [entry('one'), entry('two'), entry('three')];
    const first = await notion.upsert(items);
    expect(first.resumeFrom).toBeGreaterThan(0);
    expect(first.resumeFrom).toBeLessThan(items.length);
  });

  it('asks before archiving more than the cap', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      id: index.toString(16).padStart(32, 'e'),
      dajareId: `old-${index}`,
    }));
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.includes('/blocks/')) return Response.json({ results: [], has_more: false });
      if (path.endsWith('/databases') && init?.method === 'POST') {
        return Response.json({ id: 'b'.repeat(32) });
      }
      if (path.includes('/query')) {
        return Response.json({
          results: rows.map((row) => ({
            id: row.id,
            properties: {
              id: { rich_text: [{ plain_text: row.dajareId }] },
              アーカイブ: { checkbox: false },
            },
          })),
          has_more: false,
        });
      }
      return Response.json({});
    }) as typeof fetch;
    const notion = createNotionClient({
      token: ['notion', 'placeholder'].join('-'),
      pageId: 'd'.repeat(32),
      fetchImpl,
      sleep: async () => undefined,
      intervalMs: 0,
      budget: new SubrequestBudget(80),
    });
    await notion.ensure();
    const held = await notion.archive(['kept'], null, false);
    expect(held.needConfirm).toBe(true);
    expect(held.wouldArchive).toBe(10);
    expect(held.archived).toBe(0);
  });

  it('returns a long Retry-After instead of sleeping in the worker', async () => {
    let slept = 0;
    const fetchImpl = (async (url: string) => {
      if (String(url).includes('/blocks/')) {
        return new Response(JSON.stringify({ results: [], has_more: false }), {
          status: 429,
          headers: { 'retry-after': '30' },
        });
      }
      return Response.json({});
    }) as typeof fetch;
    const notion = createNotionClient({
      token: ['notion', 'placeholder'].join('-'),
      pageId: 'd'.repeat(32),
      fetchImpl,
      sleep: async (ms) => {
        slept += ms;
      },
      intervalMs: 0,
    });
    await expect(notion.ensure()).rejects.toMatchObject({ ms: 30_000 });
    expect(slept).toBe(0);
  });

  it('refetches an unknown signing key once', async () => {
    resetCertCache();
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches += 1;
      const keys = fetches === 1 ? { old: 'not-a-cert' } : { other: 'not-a-cert' };
      return Response.json(keys, { headers: { 'cache-control': 'max-age=3600' } });
    }) as typeof fetch;
    await expect(loadSecureTokenKey('kid-new', fetchImpl, () => 1_000_000)).rejects.toThrow(/鍵/);
    expect(fetches).toBe(2);
    await expect(loadSecureTokenKey('kid-new', fetchImpl, () => 1_000_000)).rejects.toThrow(/鍵/);
    expect(fetches).toBe(2);
  });

  it('keeps the first page in the tally when the count resumes', async () => {
    const rows = Array.from({ length: 110 }, (_, index) => ({
      id: index.toString(16).padStart(32, 'f'),
      dajareId: `row-${index}`,
    }));
    const live = rows.slice(30).map((row) => row.dajareId);
    const patches: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (path.includes('/blocks/')) return Response.json({ results: [], has_more: false });
      if (path.endsWith('/databases') && init?.method === 'POST') {
        return Response.json({ id: 'b'.repeat(32) });
      }
      if (path.includes('/query')) {
        const start = body.start_cursor ? Number(body.start_cursor) : 0;
        const slice = rows.slice(start, start + 100);
        const next = start + 100 < rows.length ? String(start + 100) : null;
        return Response.json({
          results: slice.map((row) => ({
            id: row.id,
            properties: {
              id: { rich_text: [{ plain_text: row.dajareId }] },
              アーカイブ: { checkbox: false },
            },
          })),
          has_more: next !== null,
          next_cursor: next,
        });
      }
      if (path.includes('/pages/') && init?.method === 'PATCH') {
        patches.push(path.split('/pages/')[1] ?? '');
        return Response.json({});
      }
      return Response.json({});
    }) as typeof fetch;
    const first = createNotionClient({
      token: ['notion', 'placeholder'].join('-'),
      pageId: 'd'.repeat(32),
      fetchImpl,
      sleep: async () => undefined,
      intervalMs: 0,
      budget: new SubrequestBudget(3),
    });
    const paused = await first.archive(live, null, false);
    expect(paused.counting).toBe(true);
    expect(paused.archived).toBe(0);
    expect(patches).toHaveLength(0);
    const second = createNotionClient({
      token: ['notion', 'placeholder'].join('-'),
      pageId: 'd'.repeat(32),
      fetchImpl,
      sleep: async () => undefined,
      intervalMs: 0,
      budget: new SubrequestBudget(80),
    });
    const held = await second.archive(live, paused.nextCursor, false);
    expect(held.needConfirm).toBe(true);
    expect(held.wouldArchive).toBe(30);
    expect(held.archived).toBe(0);
    expect(patches).toHaveLength(0);
  });

  it('does not post a second page when create returns 500', async () => {
    let posts = 0;
    const pageId = 'a'.repeat(32);
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.includes('/blocks/')) return Response.json({ results: [], has_more: false });
      if (path.endsWith('/databases') && init?.method === 'POST') {
        return Response.json({ id: 'b'.repeat(32) });
      }
      if (path.includes('/query')) {
        const results =
          posts > 0
            ? [
                {
                  id: pageId,
                  properties: {
                    id: { rich_text: [{ plain_text: 'id-1' }] },
                    照合: { rich_text: [{ plain_text: 'stored' }] },
                    アーカイブ: { checkbox: false },
                  },
                },
              ]
            : [];
        return Response.json({ results, has_more: false });
      }
      if (path === 'https://api.notion.com/v1/pages' && init?.method === 'POST') {
        posts += 1;
        return new Response('no', { status: 500 });
      }
      return Response.json({});
    }) as typeof fetch;
    const notion = createNotionClient({
      token: ['notion', 'placeholder'].join('-'),
      pageId: 'd'.repeat(32),
      fetchImpl,
      sleep: async () => undefined,
      intervalMs: 0,
    });
    await notion.ensure();
    await expect(notion.upsert([entry('id-1')])).resolves.toMatchObject({ created: 1 });
    expect(posts).toBe(1);
  });

  it('archives a duplicate row instead of creating another', async () => {
    const hash = await entryFingerprint(entry('id-1'));
    const patches: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.includes('/blocks/')) return Response.json({ results: [], has_more: false });
      if (path.endsWith('/databases') && init?.method === 'POST') {
        return Response.json({ id: 'b'.repeat(32) });
      }
      if (path.includes('/query')) {
        return Response.json({
          results: ['a', 'c'].map((prefix) => ({
            id: prefix.repeat(32),
            properties: {
              id: { rich_text: [{ plain_text: 'id-1' }] },
              照合: { rich_text: [{ plain_text: hash }] },
              アーカイブ: { checkbox: false },
            },
          })),
          has_more: false,
        });
      }
      if (path.includes('/pages/') && init?.method === 'PATCH') {
        patches.push(path.split('/pages/')[1] ?? '');
        return Response.json({});
      }
      if (path.endsWith('/pages') && init?.method === 'POST') {
        throw new Error('created');
      }
      return Response.json({});
    }) as typeof fetch;
    const notion = createNotionClient({
      token: ['notion', 'placeholder'].join('-'),
      pageId: 'd'.repeat(32),
      fetchImpl,
      sleep: async () => undefined,
      intervalMs: 0,
    });
    await notion.ensure();
    await expect(notion.upsert([entry('id-1')])).resolves.toMatchObject({
      created: 0,
      unchanged: 1,
    });
    expect(patches).toEqual(['c'.repeat(32)]);
  });
});
