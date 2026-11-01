import { describe, expect, it, vi } from 'vitest';
import { runNotionBackup } from '../src/notion/client';
import { notionPanel } from '../src/ui/panel';
import { archiveNeedsConfirm, backupBlockReason, type NotionDajare } from '../src/notion/plan';

const entry = (id: string): NotionDajare => ({
  id,
  text: '布団がふっとんだ',
  scene: '朝',
  addedAt: '2026-10-02',
  addedAtNote: '',
  reading: '',
  source: '',
  rating: null,
  favorite: false,
  tags: [],
  speakers: [],
  memo: '',
  updatedAt: '2026-10-02T00:00:00.000Z',
});

describe('notion open panel', () => {
  it('S24 a blocked list can be explained while start stays disabled', () => {
    expect(
      backupBlockReason({ mode: 'cloud', serverReady: false, readError: null, count: 4 }),
    ).toBe('loading');
    expect(
      backupBlockReason({ mode: 'cloud', serverReady: true, readError: '読めない', count: 4 }),
    ).toBe('error');
    const reason = '共有の紙を読み終えてから保管します';
    const loading = notionPanel('idle', reason, { allowStart: false });
    expect(loading).toContain('はじめる');
    expect(loading).toContain('disabled');
    const sameWords = notionPanel('idle', reason);
    expect(sameWords).toContain(reason);
    expect(sameWords).not.toContain('disabled');
    const failed = notionPanel('idle', '共有の紙を読めないので保管しません', { allowStart: false });
    expect(failed).toContain('disabled');
    const running = notionPanel('running', '送っています… 0/10');
    expect(running).toContain('はじめる');
    expect(running).toContain('disabled');
    const retry = notionPanel('done', 'Notionへの保管が途中で止まりました。混んでいます', {
      failure: true,
    });
    expect(retry).toContain('はじめる');
    expect(retry).not.toContain('disabled');
    const missing = notionPanel('done', 'Notion保管のリレーが未設定です', { failure: true });
    expect(missing).toContain('はじめる');
    const success = notionPanel('done', '最終保管 2026-11-01');
    expect(success).not.toContain('はじめる');
  });

  it('S25 archive confirmation follows the cap', () => {
    expect(archiveNeedsConfirm(6, 26)).toBe(false);
    expect(archiveNeedsConfirm(7, 26)).toBe(true);
    expect(archiveNeedsConfirm(5, 10)).toBe(false);
    expect(archiveNeedsConfirm(6, 10)).toBe(true);
  });

  it('S26 a failed backup does not schedule another run when time passes', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchImpl = (async (_url: string, init?: RequestInit) => {
        calls += 1;
        const body = JSON.parse(String(init?.body)) as { op?: string };
        if (body.op === 'ensure') {
          return Response.json({ databaseId: 'db-1', lastBackupAt: null });
        }
        return new Response(JSON.stringify({ error: 'Notionが混み合っています' }), { status: 502 });
      }) as typeof fetch;
      const pending = runNotionBackup({
        relayUrl: 'https://notion-backup.test/notion-backup',
        token: ['browser', 'placeholder'].join('-'),
        entries: [entry('id-1')],
        fetchImpl,
      });
      await expect(pending).rejects.toThrow(/混み合っています/);
      const afterFailure = calls;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(afterFailure);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('M4 a retry wait does not send again after stop', async () => {
    let calls = 0;
    let stopped = false;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { op?: string };
      if (body.op === 'ensure' && calls === 1) {
        return Response.json({ retryAfterMs: 1000, databaseId: 'db-1', lastBackupAt: null });
      }
      if (body.op === 'ensure') {
        return Response.json({ databaseId: 'db-1', lastBackupAt: null });
      }
      return Response.json({ created: 1, updated: 0, unchanged: 0 });
    }) as typeof fetch;
    await expect(
      runNotionBackup({
        relayUrl: 'https://notion-backup.test/notion-backup',
        token: ['browser', 'placeholder'].join('-'),
        entries: [entry('id-1')],
        fetchImpl,
        sleep: async () => {
          stopped = true;
        },
        shouldContinue: () => !stopped,
      }),
    ).rejects.toThrow(/中止しました/);
    expect(calls).toBe(1);
  });
});
