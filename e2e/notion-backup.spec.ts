import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.use({ deviceScaleFactor: 1 });

const shotDir = 'screenshots/notion';
mkdirSync(shotDir, { recursive: true });

function shot(page: Page, name: string): string {
  const width = page.viewportSize()?.width ?? 0;
  const device = width <= 500 ? 'iphone' : 'pc';
  return `${shotDir}/${name}_${device}_${width}.png`;
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        void Promise.race([
          document.fonts.ready,
          new Promise((done) => setTimeout(done, 4000)),
        ]).then(() => resolve(undefined));
      }),
  );
}

test('signed-out visitors see neither backup and neither hash opens a panel', async ({ page }) => {
  await page.goto('/dajare-vault/');
  await expect(page).toHaveTitle('駄洒落保管庫');
  await expect(page.getByRole('button', { name: '保管', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Notionに保管' })).toBeHidden();
  await expect(page.getByText('まだバックアップしていません')).toHaveCount(0);
  await expect(page.locator('#banner')).toBeHidden();
  await page.goto('/dajare-vault/#settings');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#settings/);
  await page.goto('/dajare-vault/?view=notion-hash#notion');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#notion/);
  await page.goto('/dajare-vault/?mock=signed-out');
  await expect(page.locator('.gsi-placeholder')).toBeVisible();
  await expect(page.getByRole('button', { name: '保管', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Notionに保管' })).toBeHidden();
  await expect(page.getByText('まだバックアップしていません')).toHaveCount(0);
  await expect(page.locator('#banner')).toBeHidden();
  await settle(page);
  await page.screenshot({ path: shot(page, 'signed_out'), animations: 'disabled' });
});

test('signed-in mock shows Notion backup to the left of 保管', async ({ page }) => {
  await page.goto('/dajare-vault/?mock=editor');
  await settle(page);
  await expect(page.locator('dajare-card').first()).toBeVisible();
  const notion = page.getByRole('button', { name: 'Notionに保管' });
  const keep = page.getByRole('button', { name: '保管', exact: true });
  await expect(notion).toBeVisible();
  await expect(keep).toBeVisible();
  await expect(page.getByText('まだバックアップしていません')).toBeVisible();
  await expect(page.locator('#banner')).toBeVisible();
  const notionBox = await notion.boundingBox();
  const keepBox = await keep.boundingBox();
  expect(notionBox && keepBox && notionBox.x + notionBox.width <= keepBox.x + 1).toBe(true);
  await page.screenshot({ path: shot(page, 'signed_in'), animations: 'disabled' });
  await page
    .locator('.mast-actions')
    .screenshot({ path: shot(page, 'buttons'), animations: 'disabled' });
});

test('logout hides both backups immediately and a direct hash does not reopen them', async ({
  page,
}) => {
  await page.goto('/dajare-vault/?mock=editor');
  await expect(page.getByRole('button', { name: '保管', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notionに保管' })).toBeVisible();
  await expect(page.getByText('まだバックアップしていません')).toBeVisible();
  await page.goto('/dajare-vault/?mock=editor#settings');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .locator('[data-action="sign-out"]')
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保管', exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Notionに保管' })).toBeHidden();
  await expect(page.getByText('まだバックアップしていません')).toHaveCount(0);
  await expect(page.getByText(/最後にバックアップ|最終保管|前回の Notion/)).toHaveCount(0);
  await expect(page.locator('#banner')).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('');
  await expect(page).toHaveURL(/mock=editor$/);
  let relayCalls = 0;
  await page.route('https://notion-backup.test/**', async (route) => {
    relayCalls += 1;
    await route.abort();
  });
  await page.evaluate(() => {
    location.hash = '#settings';
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#settings/);
  await page.evaluate(() => {
    location.hash = '#notion';
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#notion/);
  expect(relayCalls).toBe(0);
});

test('#notion opens the panel and does not start a backup', async ({ page }) => {
  let relayCalls = 0;
  await page.route('https://notion-backup.test/**', async (route) => {
    relayCalls += 1;
    await route.abort();
  });
  await page.goto('/dajare-vault/?mock=editor#notion');
  await expect(page.getByRole('heading', { name: 'Notionに保管' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'はじめる' })).toBeVisible();
  await expect(page.getByText(/送っています/)).toHaveCount(0);
  expect(relayCalls).toBe(0);
});

test('backup reports progress and success through the mocked relay', async ({ page }) => {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ensures = 0;
  let upserts = 0;
  await page.route('https://notion-backup.test/**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as {
      op?: string;
      entries?: unknown[];
    };
    if (body.op === 'ensure') {
      ensures += 1;
      await route.fulfill({ json: { databaseId: 'db-1', lastBackupAt: null } });
      return;
    }
    if (body.op === 'upsert') {
      upserts += 1;
      if (upserts === 1) await held;
      await route.fulfill({
        json: { created: 0, updated: body.entries?.length ?? 0, unchanged: 0 },
      });
      return;
    }
    if (body.op === 'archive') {
      await route.fulfill({ json: { archived: 2, done: true, nextCursor: null } });
      return;
    }
    await route.fulfill({ json: { lastBackupAt: '2026-10-31T03:00:00.000Z' } });
  });
  await page.goto('/dajare-vault/?mock=editor');
  await expect(page.locator('dajare-card').first()).toBeVisible();
  await page.locator('header.masthead button').filter({ hasText: 'Notionに保管' }).click();
  await page.getByRole('button', { name: 'はじめる' }).click();
  await expect(page.getByText(/送っています/)).toBeVisible();
  await page.screenshot({ path: shot(page, 'progress'), animations: 'disabled' });
  release();
  await expect(page.getByText(/しまって 2 件/)).toBeVisible();
  await expect(page.getByText(/最終保管/)).toBeVisible();
  expect(ensures).toBe(1);
  await page.screenshot({ path: shot(page, 'success'), animations: 'disabled' });
});

test('backup shows a failure and can be closed', async ({ page }) => {
  await page.route('https://notion-backup.test/**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { op?: string };
    if (body.op === 'ensure') {
      await route.fulfill({ json: { databaseId: 'db-1', lastBackupAt: null } });
      return;
    }
    await route.fulfill({ status: 502, json: { error: 'Notionが混み合っています' } });
  });
  await page.goto('/dajare-vault/?mock=editor');
  await page.locator('header.masthead button').filter({ hasText: 'Notionに保管' }).click();
  await page.getByRole('button', { name: 'はじめる' }).click();
  await expect(page.getByText(/途中で止まりました/)).toBeVisible();
  await expect(page.getByText('Notionが混み合っています')).toBeVisible();
  await page.screenshot({ path: shot(page, 'failure'), animations: 'disabled' });
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Notionに保管' })).toBeEnabled();
});
