import { expect, test, type Page, type Route } from '@playwright/test';

type Calls = { total: number; ensure: number; upsert: number; archive: number; finish: number };
type RelayOpts = {
  holdFirstUpsert?: Promise<void>;
  archive?: 'ok' | 'fail' | 'confirm';
  onArchive?: (body: { confirmArchive?: boolean; cursor?: string | null }) => void;
};

const IDLE = '紙を Notion に控えます';
const EMPTY = '紙が無いので保管しません';

function headerNotion(page: Page) {
  return page.locator('header.masthead button').filter({ hasText: 'Notionに保管' });
}

function startButton(page: Page) {
  return page.locator('[role="dialog"] button').filter({ hasText: 'はじめる' });
}

async function relay(page: Page, opts: RelayOpts = {}): Promise<Calls> {
  const calls: Calls = { total: 0, ensure: 0, upsert: 0, archive: 0, finish: 0 };
  await page.route('https://notion-backup.test/**', async (route: Route) => {
    const body = JSON.parse(route.request().postData() || '{}') as {
      op?: string;
      entries?: unknown[];
      confirmArchive?: boolean;
      cursor?: string | null;
    };
    const op = body.op ?? '';
    calls.total += 1;
    if (op === 'ensure') calls.ensure += 1;
    if (op === 'upsert') calls.upsert += 1;
    if (op === 'archive') calls.archive += 1;
    if (op === 'finish') calls.finish += 1;
    if (op === 'ensure') {
      await route.fulfill({ json: { databaseId: 'db-1', lastBackupAt: null } });
      return;
    }
    if (op === 'upsert') {
      if (opts.holdFirstUpsert && calls.upsert === 1) await opts.holdFirstUpsert;
      await route.fulfill({
        json: { created: 0, updated: body.entries?.length ?? 0, unchanged: 0 },
      });
      return;
    }
    if (op === 'archive') {
      opts.onArchive?.(body);
      if (opts.archive === 'fail') {
        await route.fulfill({ status: 502, json: { error: 'Notionが混み合っています' } });
        return;
      }
      if (opts.archive === 'confirm' && !body.confirmArchive) {
        await route.fulfill({
          json: {
            archived: 0,
            done: false,
            nextCursor: null,
            needConfirm: true,
            wouldArchive: 9999,
          },
        });
        return;
      }
      await route.fulfill({ json: { archived: 0, done: true, nextCursor: null } });
      return;
    }
    await route.fulfill({ json: { lastBackupAt: '2026-11-01T08:00:00.000Z' } });
  });
  return calls;
}

const settle = (page: Page) => page.waitForTimeout(800);

async function openEditor(page: Page, hash = ''): Promise<void> {
  await page.goto(`/dajare-vault/?mock=editor${hash}`);
  await expect(page.locator('dajare-card').first()).toBeVisible();
}

test('S01 signed-out visitors see no backup UI and hashes do nothing', async ({ page }) => {
  const calls = await relay(page);
  for (const url of ['/dajare-vault/?mock=signed-out', '/dajare-vault/']) {
    await page.goto(url);
    await expect(page.getByRole('button', { name: '保管', exact: true })).toBeHidden();
    await expect(headerNotion(page)).toBeHidden();
    await expect(page.getByText('まだバックアップしていません')).toHaveCount(0);
    await expect(page.locator('#banner')).toBeHidden();
  }
  await page.goto('/dajare-vault/#settings');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#/);
  await page.goto('/dajare-vault/?view=fresh#notion');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#notion/);
  expect(calls.total).toBe(0);
  await page.screenshot({
    path: `screenshots/notion/start_signed_out_${page.viewportSize()?.width ?? 0}.png`,
    animations: 'disabled',
  });
});

test('S02 a viewer cannot open Notion backup', async ({ page }) => {
  const calls = await relay(page);
  await page.goto('/dajare-vault/?mock=viewer#notion');
  await expect(page.getByRole('button', { name: '保管', exact: true })).toBeVisible();
  await expect(headerNotion(page)).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#notion/);
  expect(calls.total).toBe(0);
});

test('S03 Notion backup sits to the left of JSON export', async ({ page }) => {
  await openEditor(page);
  const notion = headerNotion(page);
  const keep = page.getByRole('button', { name: '保管', exact: true });
  await expect(notion).toBeVisible();
  await expect(keep).toBeVisible();
  const notionBox = await notion.boundingBox();
  const keepBox = await keep.boundingBox();
  expect(notionBox && keepBox && notionBox.x + notionBox.width <= keepBox.x + 1).toBe(true);
});

test('S04 the header button only opens the idle panel', async ({ page }) => {
  const calls = await relay(page);
  await openEditor(page);
  await headerNotion(page).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(startButton(page)).toBeEnabled();
  await expect(page.getByText(IDLE)).toBeVisible();
  await expect(page).toHaveURL(/#notion/);
  await settle(page);
  expect(calls.total).toBe(0);
  await page.screenshot({
    path: `screenshots/notion/start_idle_${page.viewportSize()?.width ?? 0}.png`,
    animations: 'disabled',
  });
});

test('S05 repeated header clicks never call the relay', async ({ page }) => {
  const calls = await relay(page);
  await openEditor(page);
  for (let i = 0; i < 3; i += 1) {
    await headerNotion(page).click();
    await expect(page.getByText(IDLE)).toBeVisible();
    await page.getByRole('button', { name: '閉じる' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await settle(page);
  expect(calls.total).toBe(0);
});

test('S06 a direct hash and a reload only open the panel', async ({ page }) => {
  const calls = await relay(page);
  await page.goto('/dajare-vault/?mock=editor#notion');
  await expect(page.getByText(IDLE)).toBeVisible();
  await page.reload();
  await expect(page.getByText(IDLE)).toBeVisible();
  await expect(startButton(page)).toBeEnabled();
  await settle(page);
  expect(calls.total).toBe(0);
});

test('S07 backup starts only from はじめる', async ({ page }) => {
  const calls = await relay(page);
  await openEditor(page);
  const cards = await page.locator('dajare-card').count();
  await headerNotion(page).click();
  await expect(page.getByText(IDLE)).toBeVisible();
  await settle(page);
  expect(calls.total).toBe(0);
  await startButton(page).click();
  await expect(page.getByText(/送っています/)).toBeVisible();
  await page.screenshot({
    path: `screenshots/notion/start_running_${page.viewportSize()?.width ?? 0}.png`,
    animations: 'disabled',
  });
  await expect(page.getByText(/最終保管/)).toBeVisible();
  expect(calls).toMatchObject({
    ensure: 1,
    upsert: Math.ceil(cards / 10),
    archive: 1,
    finish: 1,
  });
  await page.screenshot({
    path: `screenshots/notion/start_success_${page.viewportSize()?.width ?? 0}.png`,
    animations: 'disabled',
  });
});

test('S08 a failure stays put until はじめる retries from ensure', async ({ page }) => {
  let fail = true;
  const calls = { total: 0, ensure: 0, upsert: 0, archive: 0, finish: 0 };
  await page.route('https://notion-backup.test/**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as {
      op?: string;
      entries?: unknown[];
    };
    calls.total += 1;
    if (body.op === 'ensure') calls.ensure += 1;
    if (body.op === 'upsert') calls.upsert += 1;
    if (body.op === 'archive') calls.archive += 1;
    if (body.op === 'finish') calls.finish += 1;
    if (body.op === 'ensure') {
      await route.fulfill({ json: { databaseId: 'db-1', lastBackupAt: null } });
      return;
    }
    if (body.op === 'upsert') {
      await route.fulfill({
        json: { created: 0, updated: body.entries?.length ?? 0, unchanged: 0 },
      });
      return;
    }
    if (body.op === 'archive' && fail) {
      await route.fulfill({ status: 502, json: { error: 'Notionが混み合っています' } });
      return;
    }
    if (body.op === 'archive') {
      await route.fulfill({ json: { archived: 0, done: true, nextCursor: null } });
      return;
    }
    await route.fulfill({ json: { lastBackupAt: '2026-11-01T08:00:00.000Z' } });
  });
  await openEditor(page);
  await headerNotion(page).click();
  await startButton(page).click();
  await expect(page.getByText(/途中で止まりました/)).toBeVisible();
  await expect(startButton(page)).toBeEnabled();
  await page.screenshot({
    path: `screenshots/notion/start_error_${page.viewportSize()?.width ?? 0}.png`,
    animations: 'disabled',
  });
  const afterFailure = calls.total;
  await settle(page);
  expect(calls.total).toBe(afterFailure);
  fail = false;
  const ensuresBeforeRetry = calls.ensure;
  await startButton(page).click();
  await expect(page.getByText(/最終保管/)).toBeVisible();
  expect(calls.ensure).toBe(ensuresBeforeRetry + 1);
});

test('S09 a second はじめる while running does nothing', async ({ page }) => {
  let release = (): void => undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = await relay(page, { holdFirstUpsert: hold });
  await page.goto('/dajare-vault/?mock=editor#notion');
  await startButton(page).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByText(/送っています/)).toBeVisible();
  await expect(startButton(page)).toBeVisible();
  await expect(startButton(page)).toBeDisabled();
  expect(calls.ensure).toBe(1);
  release();
  await expect(page.getByText(/最終保管/)).toBeVisible();
  expect(calls.ensure).toBe(1);
  expect(calls.finish).toBe(1);
});

test('S10 close and Esc leave the idle panel without a request', async ({ page }) => {
  const calls = await relay(page);
  await page.goto('/dajare-vault/?mock=editor#notion');
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#notion/);
  await page.goto('/dajare-vault/?mock=editor#notion');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#notion/);
  await settle(page);
  expect(calls.total).toBe(0);
});

test('S11 closing while running does not reopen when it finishes', async ({ page }) => {
  let release = (): void => undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = await relay(page, { holdFirstUpsert: hold });
  await page.goto('/dajare-vault/?mock=editor#notion');
  await startButton(page).click();
  await expect(page.getByText(/送っています/)).toBeVisible();
  await expect(headerNotion(page)).toBeDisabled();
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#notion/);
  release();
  await settle(page);
  await expect(page.getByText(/最終保管/)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#notion/);
  expect(calls.finish).toBe(1);
  await expect(headerNotion(page)).toBeEnabled();
});

test('S12 reopening while running shows progress and does not start again', async ({ page }) => {
  let release = (): void => undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = await relay(page, { holdFirstUpsert: hold });
  await page.goto('/dajare-vault/?mock=editor#notion');
  await startButton(page).click();
  await expect(page.getByText(/送っています/)).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();
  await page.evaluate(() => {
    location.hash = '#notion';
  });
  await expect(page.getByText(/送っています/)).toBeVisible();
  await expect(startButton(page)).toBeDisabled();
  expect(calls.ensure).toBe(1);
  release();
  await expect(page.getByText(/最終保管/)).toBeVisible();
  expect(calls.ensure).toBe(1);
});

test('S13 declining the archive confirm closes and does not finish', async ({ page }) => {
  const calls = await relay(page, { archive: 'confirm' });
  await page.goto('/dajare-vault/?mock=editor#notion');
  await startButton(page).click();
  await expect(page.getByRole('button', { name: '続ける' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'やめる' })).toBeVisible();
  await page.getByRole('button', { name: 'やめる' }).click();
  await settle(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.archive).toBe(1);
  expect(calls.finish).toBe(0);

  await page.goto('/dajare-vault/?mock=editor#notion');
  await startButton(page).click();
  await expect(page.getByRole('button', { name: 'やめる' })).toBeVisible();
  const archives = calls.archive;
  await page.keyboard.press('Escape');
  await settle(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.archive).toBe(archives + 1);
  expect(calls.finish).toBe(0);
});

test('S14 continuing the archive confirm finishes', async ({ page }) => {
  const bodies: { confirmArchive?: boolean; cursor?: string | null }[] = [];
  const calls = await relay(page, {
    archive: 'confirm',
    onArchive: (body) => bodies.push(body),
  });
  await page.goto('/dajare-vault/?mock=editor#notion');
  await startButton(page).click();
  await page.getByRole('button', { name: '続ける' }).click();
  await expect(page.getByText(/最終保管/)).toBeVisible();
  expect(bodies[1]).toMatchObject({ confirmArchive: true, cursor: null });
  expect(calls.finish).toBe(1);
});

test('S15 a confirm that arrives after close does not resume', async ({ page }) => {
  let release = (): void => undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = await relay(page, { holdFirstUpsert: hold, archive: 'confirm' });
  await page.goto('/dajare-vault/?mock=editor#notion');
  await startButton(page).click();
  await expect(page.getByText(/送っています/)).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();
  release();
  await settle(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.archive).toBe(1);
  expect(calls.finish).toBe(0);
});

test('S16 reopening after success is idle and does not run again', async ({ page }) => {
  const calls = await relay(page);
  await openEditor(page);
  await headerNotion(page).click();
  await startButton(page).click();
  await expect(page.getByText(/最終保管/)).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();
  await headerNotion(page).click();
  await expect(page.getByText(IDLE)).toBeVisible();
  await settle(page);
  expect(calls.ensure).toBe(1);
});

test('S17 flipping the hash does not call the relay', async ({ page }) => {
  const calls = await relay(page);
  await openEditor(page);
  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => {
      location.hash = '';
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      location.hash = '#notion';
    });
    await page.waitForTimeout(300);
  }
  expect(calls.total).toBe(0);
});

test('S18 back and forward do not call the relay', async ({ page }) => {
  const calls = await relay(page);
  await openEditor(page);
  await page.evaluate(() => {
    location.hash = '#notion';
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack();
  await settle(page);
  await page.goForward();
  await settle(page);
  expect(calls.total).toBe(0);
});

test('S19 an empty vault can open the panel but cannot start', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dajareVault:v1', JSON.stringify({ schemaVersion: 3, items: [] }));
  });
  const calls = await relay(page);
  await page.goto('/dajare-vault/?mock=editor');
  await expect(headerNotion(page)).toBeVisible();
  await expect(headerNotion(page)).toBeEnabled();
  await headerNotion(page).click();
  await expect(page.getByText(EMPTY)).toBeVisible();
  await expect(startButton(page)).toBeDisabled();
  await settle(page);
  expect(calls.total).toBe(0);
});

test('S20 logout while running stops later relay calls', async ({ page }) => {
  let release = (): void => undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls = await relay(page, { holdFirstUpsert: hold });
  await page.goto('/dajare-vault/?mock=editor#notion');
  await startButton(page).click();
  await expect(page.getByText(/送っています/)).toBeVisible();
  await page
    .locator('[data-action="sign-out"]')
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const atLogout = calls.total;
  release();
  await settle(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#notion/);
  expect(calls.total).toBe(atLogout);
  expect(calls.finish).toBe(0);
  await page.evaluate(() => {
    location.hash = '#notion';
  });
  await settle(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).not.toHaveURL(/#notion/);
});

test('S21 logout from the idle panel does not reopen it', async ({ page }) => {
  const calls = await relay(page);
  await page.goto('/dajare-vault/?mock=editor#notion');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page
    .locator('[data-action="sign-out"]')
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(headerNotion(page)).toBeHidden();
  await page.evaluate(() => {
    location.hash = '#notion';
  });
  await settle(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.total).toBe(0);
});

test('S22 the header click itself sends no request', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => document.fonts.ready);
  const seen: string[] = [];
  page.on('request', (request) => {
    seen.push(request.url());
  });
  await headerNotion(page).click();
  await expect(page.getByText(IDLE)).toBeVisible();
  await settle(page);
  expect(seen).toEqual([]);
});
