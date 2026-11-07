// @vitest-environment jsdom
// 仕様の値（「Notionで開く」、_blank、noopener、www.notion.so）は定義から読まず、ここに文字で書く。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTION_RELAY_MISSING } from '../src/notion/messages';
import { runNotionBackup } from '../src/notion/client';
import type { NotionDajare } from '../src/notion/plan';
import { memoryStorage } from '../src/store/memory';
import { createStore } from '../src/store/store';
import { mount } from '../src/ui/app';
import { notionPanel } from '../src/ui/panel';

const URL_OK = 'https://www.notion.so/0123456789abcdef0123456789abcdef';
const BAD_URLS: unknown[] = [
  'https://evil.example/0123456789abcdef0123456789abcdef',
  'javascript:alert(1)',
  'http://www.notion.so/0123456789abcdef0123456789abcdef',
  'https://www.notion.so/0123456789abcdef0123456789abcdef?token=x',
  42,
  { href: URL_OK },
];

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

function relay(finish: Record<string, unknown>): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { op: string; entries?: unknown[] };
    if (body.op === 'ensure')
      return Response.json({ databaseId: 'b'.repeat(32), lastBackupAt: null });
    if (body.op === 'upsert') {
      return Response.json({ created: body.entries?.length ?? 0, updated: 0, unchanged: 0 });
    }
    if (body.op === 'archive') return Response.json({ archived: 1, done: true, nextCursor: null });
    return Response.json(finish);
  }) as typeof fetch;
}

function run(finish: Record<string, unknown>) {
  return runNotionBackup({
    relayUrl: 'https://notion-backup.test/notion-backup',
    token: ['browser', 'placeholder'].join('-'),
    entries: [entry('id-1'), entry('id-2')],
    fetchImpl: relay(finish),
  });
}

function html(markup: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = markup;
  return root;
}

describe('notion link in the backup client', () => {
  it('keeps a valid notionUrl from finish', async () => {
    const result = await run({ lastBackupAt: '2026-11-08T00:04:00.000Z', notionUrl: URL_OK });
    expect(result.notionUrl).toBe(URL_OK);
    expect(result).toMatchObject({
      created: 2,
      archived: 1,
      lastBackupAt: '2026-11-08T00:04:00.000Z',
    });
  });

  it('drops a missing, null or unsafe notionUrl and still succeeds', async () => {
    for (const notionUrl of [undefined, null, ...BAD_URLS]) {
      const finish: Record<string, unknown> = { lastBackupAt: '2026-11-08T00:04:00.000Z' };
      if (notionUrl !== undefined) finish.notionUrl = notionUrl;
      const result = await run(finish);
      expect(result.notionUrl, String(notionUrl)).toBeNull();
      expect(result).toMatchObject({
        created: 2,
        updated: 0,
        unchanged: 0,
        archived: 1,
        lastBackupAt: '2026-11-08T00:04:00.000Z',
      });
    }
  });
});

describe('notion link in the panel', () => {
  it('shows one Notionで開く link before 閉じる that opens in a new tab without a data-action', () => {
    const root = html(notionPanel('done', '新しく 1 件', { notionUrl: URL_OK }));
    const links = root.querySelectorAll('a');
    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link.textContent?.trim()).toBe('Notionで開く');
    expect(link.getAttribute('href')).toBe(URL_OK);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')?.split(/\s+/)).toContain('noopener');
    expect(link.getAttribute('rel')?.split(/\s+/)).toContain('noreferrer');
    expect(link.hasAttribute('data-action')).toBe(false);
    expect(link.hasAttribute('data-notion-link')).toBe(true);
    const close = root.querySelector('[data-action="close-panel"]');
    expect(close?.textContent).toBe('閉じる');
    expect(link.parentElement).toBe(close?.parentElement);
    expect(
      link.compareDocumentPosition(close as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(root.querySelector('[data-notion-status]')?.textContent).toBe('新しく 1 件');
  });

  it('shows no link without a url, on failure, or before the backup is done', () => {
    const cases = [
      notionPanel('done', '新しく 1 件', { notionUrl: null }),
      notionPanel('done', '新しく 1 件'),
      notionPanel('done', 'Notionへの保管が途中で止まりました。混んでいます', {
        failure: true,
        notionUrl: URL_OK,
      }),
      notionPanel('idle', '紙を Notion に控えます。', { notionUrl: URL_OK }),
      notionPanel('running', '送っています… 0/2', { notionUrl: URL_OK }),
      notionPanel('confirm', '3件をNotionでしまいます。続けますか？', { notionUrl: URL_OK }),
    ];
    for (const markup of cases) {
      const root = html(markup);
      expect(root.querySelectorAll('a')).toHaveLength(0);
      expect(root.querySelector('[data-notion-link]')).toBeNull();
      expect(root.textContent).not.toContain('Notionで開く');
    }
  });

  // 入口（safeNotionUrl）が先に弾くことだけを確かめる。href の escapeHtml は
  // tests/notion-link-escape.test.ts で入口を外して単独で確かめる。
  it('drops a url with a quote at the entry check, so no link is drawn', () => {
    const root = html(
      notionPanel('done', '新しく 1 件', { notionUrl: `${URL_OK}" onclick="alert(1)` }),
    );
    expect(root.querySelectorAll('a')).toHaveLength(0);
    expect(root.querySelector('[onclick]')).toBeNull();
    expect(root.querySelector('[data-action="close-panel"]')?.textContent).toBe('閉じる');
  });
});

describe('notion link styles', () => {
  it('gives the link the 44px tap height on narrow screens', () => {
    const css = readFileSync(resolve(__dirname, '../src/styles/app.css'), 'utf8');
    const narrow = css.indexOf('@media (max-width: 860px)');
    expect(narrow).toBeGreaterThan(-1);
    const rules = [...css.matchAll(/([^{}]+)\{\s*min-height:\s*44px;\s*\}/g)].filter(
      (match) => (match.index ?? -1) > narrow,
    );
    expect(rules.length).toBeGreaterThan(0);
    const selectors = rules.flatMap((match) => match[1].split(',').map((part) => part.trim()));
    expect(selectors).toContain('.sheet-actions a.sheet-link');
  });
});

describe('notion link in the app', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    document.body.replaceChildren();
  });

  // e2e のビルドは VITE_FORCE_LOCAL=1 でモックの宛先が必ず入るため、未設定は画面のテストで作る。
  it('shows no link when the relay is not configured', async () => {
    vi.stubEnv('VITE_NOTION_RELAY_URL', '');
    vi.stubEnv('VITE_FORCE_LOCAL', '');
    vi.stubEnv('DEV', false);
    const calls: string[] = [];
    vi.stubGlobal('fetch', (async (url: string) => {
      calls.push(String(url));
      return Response.json({});
    }) as typeof fetch);
    window.history.replaceState(null, '', '/?mock=editor');
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    mount(root, createStore(memoryStorage(), { seedOnEmpty: true }));
    root.querySelector<HTMLButtonElement>('[data-action="notion-open"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-action="notion-backup"]')?.click();
    await vi.waitFor(() =>
      expect(root.querySelector('[data-notion-status]')?.textContent).toBe(NOTION_RELAY_MISSING),
    );
    const dialog = root.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelectorAll('a')).toHaveLength(0);
    expect(dialog?.querySelector('[data-notion-link]')).toBeNull();
    expect(dialog?.querySelector('[data-action="notion-backup"]')?.textContent).toBe('はじめる');
    expect(dialog?.querySelector('[data-action="close-panel"]')?.textContent).toBe('閉じる');
    expect(calls).toHaveLength(0);
  });

  it('keeps the link of a backup that finished while the panel was closed', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ops: string[] = [];
    const inner = relay({ lastBackupAt: '2026-11-08T00:04:00.000Z', notionUrl: URL_OK });
    vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { op: string };
      ops.push(body.op);
      if (body.op === 'upsert') await held;
      return inner(url, init);
    }) as typeof fetch);
    window.history.replaceState(null, '', '/?mock=editor');
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    mount(root, createStore(memoryStorage(), { seedOnEmpty: true }));
    const open = () =>
      root.querySelector<HTMLButtonElement>('[data-action="notion-open"]')?.click();
    open();
    root.querySelector<HTMLButtonElement>('[data-action="notion-backup"]')?.click();
    await vi.waitFor(() => expect(ops).toContain('upsert'));
    root.querySelector<HTMLButtonElement>('[data-action="close-panel"]')?.click();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    release();
    await vi.waitFor(() => expect(ops).toContain('finish'));
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLButtonElement>('[data-action="notion-open"]')?.disabled).toBe(
        false,
      ),
    );
    open();
    const status = root.querySelector('[data-notion-status]');
    expect(status?.textContent).toContain('新しく');
    const link = root.querySelector<HTMLAnchorElement>('[data-notion-link]');
    expect(link?.textContent?.trim()).toBe('Notionで開く');
    expect(link?.getAttribute('href')).toBe(URL_OK);
    root.querySelector<HTMLButtonElement>('[data-action="close-panel"]')?.click();
    open();
    expect(root.querySelector('[data-action="notion-backup"]')?.textContent).toBe('はじめる');
    expect(root.querySelector('[data-notion-link]')).toBeNull();
  });
});
