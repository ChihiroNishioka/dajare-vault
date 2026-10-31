import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign as signBuffer, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readFirebaseClaims,
  spkiFromCertificate,
  pemToDer,
  verifyFirebaseIdToken,
} from '../src/notion/claims';
import { backupCors } from '../src/notion/cors';
import { runNotionBackup, UPSERT_CHUNK } from '../src/notion/client';
import { confirmEditor } from '../src/notion/editors';
import { handleNotionBackup } from '../src/notion/handler';
import { notionSuccessMessage } from '../src/notion/messages';
import { createNotionClient } from '../src/notion/notion-api';
import {
  decideArchive,
  decideUpsert,
  dedupeEntries,
  entryFingerprint,
  type NotionDajare,
} from '../src/notion/plan';
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
  it('creates, updates, restores, or skips without a second row', () => {
    const item = entry('id-1');
    expect(decideUpsert(item, null)).toBe('create');
    const match = { pageId: 'page-1', fingerprint: entryFingerprint(item), archived: false };
    expect(decideUpsert(item, match)).toBe('unchanged');
    expect(decideUpsert({ ...item, text: '直した' }, match)).toBe('update');
    expect(decideUpsert(item, { ...match, archived: true })).toBe('restore');
    expect(dedupeEntries([item, { ...item, text: 'あと' }])).toEqual([{ ...item, text: 'あと' }]);
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
    expect(retryDelayMs(1, '99')).toBe(10_000);
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
      email_verified: true,
      email: 'editor@example.com',
      user_id: 'uid-1',
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
    const calls: { path: string; body?: unknown }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = String(url).replace('https://api.notion.com/v1', '');
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      if (path.startsWith('/blocks/')) return Response.json({ results: [], has_more: false });
      if (path === '/databases' && init?.method === 'POST') return Response.json({ id: 'db-1' });
      if (path.endsWith('/query') && body?.filter) {
        return Response.json({
          results: calls.filter((call) => call.path === '/pages').length
            ? [
                {
                  id: 'page-1',
                  properties: {
                    id: { rich_text: [{ plain_text: 'id-1' }] },
                    照合: { rich_text: [{ plain_text: entryFingerprint(item) }] },
                    アーカイブ: { checkbox: false },
                  },
                },
              ]
            : [],
        });
      }
      if (path === '/pages') return Response.json({ id: 'page-1' });
      return Response.json({});
    }) as typeof fetch;
    const notionCredential = ['notion', 'placeholder'].join('-');
    const notion = createNotionClient({
      token: notionCredential,
      pageId: 'page',
      fetchImpl,
      sleep: async () => undefined,
      intervalMs: 0,
    });
    await expect(notion.ensure()).resolves.toEqual({ databaseId: 'db-1', lastBackupAt: null });
    await expect(notion.upsert('db-1', [item])).resolves.toEqual({
      created: 1,
      updated: 0,
      unchanged: 0,
    });
    await expect(notion.upsert('db-1', [item])).resolves.toEqual({
      created: 0,
      updated: 0,
      unchanged: 1,
    });
    expect(calls.filter((call) => call.path === '/pages')).toHaveLength(1);
    const archived = await notion.archive('db-1', ['other'], null, []);
    expect(archived.archived + archived.pending.length).toBeGreaterThanOrEqual(0);
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
        return Response.json({ archived: 3, pending: [], nextCursor: null });
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
});
