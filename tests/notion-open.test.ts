// @vitest-environment jsdom
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

function panel(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

function startButton(root: ParentNode): HTMLButtonElement | null {
  return root.querySelector('[data-action="notion-backup"]');
}

describe('notion open panel', () => {
  it('S24 a blocked list can be explained while start stays disabled', () => {
    expect(
      backupBlockReason({ mode: 'cloud', serverReady: false, readError: null, count: 4 }),
    ).toBe('loading');
    expect(
      backupBlockReason({ mode: 'cloud', serverReady: true, readError: '読めない', count: 4 }),
    ).toBe('error');
    const reason = '共有の紙を読み終えてから保管します';
    const loading = panel(notionPanel('idle', reason, { allowStart: false }));
    expect(startButton(loading)?.textContent).toBe('はじめる');
    expect(startButton(loading)?.disabled).toBe(true);
    expect(loading.querySelector('[data-notion-status]')?.textContent).toBe(reason);
    const sameWords = panel(notionPanel('idle', reason));
    expect(sameWords.querySelector('[data-notion-status]')?.textContent).toBe(reason);
    expect(startButton(sameWords)?.disabled).toBe(false);
    const failed = panel(
      notionPanel('idle', '共有の紙を読めないので保管しません', { allowStart: false }),
    );
    expect(startButton(failed)?.disabled).toBe(true);
    const running = panel(notionPanel('running', '送っています… 0/10'));
    expect(startButton(running)?.textContent).toBe('はじめる');
    expect(startButton(running)?.disabled).toBe(true);
    expect(running.querySelector('[data-notion-status]')?.textContent).toBe('送っています… 0/10');
    const retry = panel(
      notionPanel('done', 'Notionへの保管が途中で止まりました。混んでいます', {
        failure: true,
      }),
    );
    expect(startButton(retry)?.textContent).toBe('はじめる');
    expect(startButton(retry)?.disabled).toBe(false);
    const missing = panel(notionPanel('done', 'Notion保管のリレーが未設定です', { failure: true }));
    expect(startButton(missing)?.textContent).toBe('はじめる');
    const success = panel(notionPanel('done', '最終保管 2026-11-01'));
    expect(startButton(success)).toBeNull();
    expect(success.textContent).not.toContain('はじめる');
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
