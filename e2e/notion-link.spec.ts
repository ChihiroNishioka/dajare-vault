import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.use({ deviceScaleFactor: 1 });

// 仕様の値（「Notionで開く」、_blank、noopener、www.notion.so）は文字で書く。
const NOTION_URL = 'https://www.notion.so/0123456789abcdef0123456789abcdef';
const shotDir = 'docs/screenshots';
mkdirSync(shotDir, { recursive: true });

function shot(page: Page, name: string): string {
  const width = page.viewportSize()?.width ?? 0;
  const device = width <= 500 ? 'iphone' : 'pc';
  return `${shotDir}/${name}_${device}_${width}.png`;
}

type Counts = { ensure: number; upsert: number; archive: number; finish: number };

async function mockRelay(
  page: Page,
  finish: { status?: number; json: Record<string, unknown> },
  options: { upsertStatus?: number; held?: Promise<void> } = {},
): Promise<Counts> {
  const counts: Counts = { ensure: 0, upsert: 0, archive: 0, finish: 0 };
  await page.route('https://notion-backup.test/**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as {
      op?: keyof Counts;
      entries?: unknown[];
    };
    if (body.op) counts[body.op] += 1;
    if (body.op === 'ensure') {
      await route.fulfill({ json: { databaseId: 'b'.repeat(32), lastBackupAt: null } });
      return;
    }
    if (body.op === 'upsert') {
      if (options.held) await options.held;
      if (options.upsertStatus) {
        await route.fulfill({
          status: options.upsertStatus,
          json: { error: 'Notionが混み合っています' },
        });
        return;
      }
      await route.fulfill({
        json: { created: body.entries?.length ?? 0, updated: 0, unchanged: 0 },
      });
      return;
    }
    if (body.op === 'archive') {
      await route.fulfill({ json: { archived: 0, done: true, nextCursor: null } });
      return;
    }
    await route.fulfill({ status: finish.status ?? 200, json: finish.json });
  });
  await page.context().route('https://www.notion.so/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><title>Notion (mock)</title><p>mock</p>',
    }),
  );
  return counts;
}

async function startBackup(page: Page): Promise<void> {
  await page.goto('/dajare-vault/?mock=editor');
  await expect(page.locator('dajare-card').first()).toBeVisible();
  await page.locator('header.masthead button').filter({ hasText: 'Notionに保管' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'はじめる' }).click();
}

const success = { json: { lastBackupAt: '2026-11-08T00:04:00.000Z', notionUrl: NOTION_URL } };

test('the done dialog links to the Notion database in a new tab', async ({ page }) => {
  const counts = await mockRelay(page, success);
  await startBackup(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/新しく \d+ 件.*最終保管/)).toBeVisible();
  const link = dialog.getByRole('link', { name: 'Notionで開く' });
  await expect(link).toHaveCount(1);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', NOTION_URL);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /(^|\s)noopener(\s|$)/);
  await expect(dialog.getByRole('button', { name: '閉じる' })).toBeVisible();
  await expect.poll(() => counts.finish).toBe(1);
});

test('tapping the link opens Notion and keeps the dialog without another backup', async ({
  page,
}) => {
  const counts = await mockRelay(page, success);
  await startBackup(page);
  const link = page.getByRole('link', { name: 'Notionで開く' });
  await expect(link).toBeVisible();
  const opened = page.context().waitForEvent('page');
  await link.click();
  const tab = await opened;
  await expect.poll(() => tab.url()).toBe(NOTION_URL);
  await expect(tab).toHaveTitle('Notion (mock)');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notionで開く' })).toBeVisible();
  expect(counts.ensure).toBe(1);
  expect(counts.finish).toBe(1);
  await tab.close();
});

for (const [label, json] of [
  ['missing', { lastBackupAt: '2026-11-08T00:04:00.000Z' }],
  ['null', { lastBackupAt: '2026-11-08T00:04:00.000Z', notionUrl: null }],
] as const) {
  test(`no link when notionUrl is ${label}`, async ({ page }) => {
    await mockRelay(page, { json });
    await startBackup(page);
    await expect(page.getByText(/新しく \d+ 件.*最終保管/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Notionで開く' })).toHaveCount(0);
    await expect(page.locator('[data-notion-link]')).toHaveCount(0);
  });
}

for (const bad of [
  'https://evil.example/x',
  'javascript:alert(1)',
  'http://www.notion.so/0123456789abcdef0123456789abcdef',
]) {
  test(`no link and still a success when notionUrl is ${bad}`, async ({ page }) => {
    await mockRelay(page, { json: { lastBackupAt: '2026-11-08T00:04:00.000Z', notionUrl: bad } });
    await startBackup(page);
    await expect(page.getByText(/新しく \d+ 件.*最終保管/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Notionで開く' })).toHaveCount(0);
    await expect(page.locator('[data-notion-link]')).toHaveCount(0);
    await expect(page.locator('.field-error')).toHaveCount(0);
  });
}

for (const where of ['upsert', 'finish'] as const) {
  test(`no link when ${where} fails with 502`, async ({ page }) => {
    await mockRelay(
      page,
      where === 'finish' ? { status: 502, json: { error: 'Notionが混み合っています' } } : success,
      where === 'upsert' ? { upsertStatus: 502 } : {},
    );
    await startBackup(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/途中で止まりました/)).toBeVisible();
    await expect(dialog.getByRole('link')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'はじめる' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '閉じる' })).toBeVisible();
  });
}

test('a backup that finished while closed shows its link on reopen, and idle has none', async ({
  page,
}) => {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const counts = await mockRelay(page, success, { held });
  await startBackup(page);
  await expect.poll(() => counts.upsert).toBeGreaterThan(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  release();
  await expect.poll(() => counts.finish).toBe(1);
  const open = page.locator('header.masthead button').filter({ hasText: 'Notionに保管' });
  await expect(open).toBeEnabled();
  await open.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/新しく \d+ 件.*最終保管/)).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Notionで開く' })).toHaveAttribute(
    'href',
    NOTION_URL,
  );
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await open.click();
  await expect(page.getByRole('button', { name: 'はじめる' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Notionで開く' })).toHaveCount(0);
});

test('the link and 閉じる fit the dialog (screenshot)', async ({ page }) => {
  await mockRelay(page, success);
  await startBackup(page);
  const dialog = page.getByRole('dialog');
  const link = dialog.getByRole('link', { name: 'Notionで開く' });
  const close = dialog.getByRole('button', { name: '閉じる' });
  await expect(link).toBeVisible();
  await expect(close).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const sheet = await page.locator('.sheet').boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  for (const box of [await link.boundingBox(), await close.boundingBox()]) {
    expect(box && sheet).toBeTruthy();
    if (!box || !sheet) continue;
    expect(box.x).toBeGreaterThanOrEqual(sheet.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(sheet.x + sheet.width + 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
  }
  if (width <= 500) {
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(fits).toBe(true);
    const clipped = await link.evaluate(
      (node) => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight + 1,
    );
    expect(clipped).toBe(false);
  }
  await page.screenshot({ path: shot(page, 'notion-link-success'), animations: 'disabled' });
});
