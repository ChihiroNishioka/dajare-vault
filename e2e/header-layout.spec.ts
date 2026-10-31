import { expect, test, type Page } from '@playwright/test';

test.use({ deviceScaleFactor: 1 });

interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
  height: number;
}

async function openMock(page: Page, mock: string): Promise<void> {
  await page.goto(`/dajare-vault/?mock=${mock}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/dajare-vault/?mock=${mock}`);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        void Promise.race([
          document.fonts.ready,
          new Promise((done) => {
            setTimeout(done, 4000);
          }),
        ]).then(() => resolve(undefined));
      }),
  );
  await expect(page.locator('dajare-card').first()).toBeVisible();
}

async function boxes(page: Page, selector: string): Promise<Box[]> {
  return page.locator(selector).evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const el = node as HTMLElement;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((node) => {
        const rect = (node as HTMLElement).getBoundingClientRect();
        return {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          height: rect.height,
        };
      }),
  );
}

function overlaps(a: Box, b: Box): boolean {
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  return bottom - top >= Math.min(a.height, b.height) * 0.45;
}

function sameLine(items: Box[]): boolean {
  if (items.length < 2) return true;
  const top = items[0].top;
  const height = items[0].height;
  return items.every(
    (item) => Math.abs(item.top - top) <= 3 && Math.abs(item.height - height) <= 3,
  );
}

function noHorizontalOverlap(items: Box[]): boolean {
  const sorted = [...items].sort((a, b) => a.left - b.left);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].left < sorted[i - 1].right - 1) return false;
  }
  return true;
}

async function expectHeaderLayout(page: Page): Promise<void> {
  const actions = await boxes(page, '.mast-actions button');
  if (actions.length > 0) {
    expect(sameLine(actions)).toBe(true);
    expect(noHorizontalOverlap(actions)).toBe(true);
  }

  const login = await boxes(page, '.gsi-slot, .account-alt, .mast-actions button');
  const loginRows: Box[][] = [];
  for (const item of login) {
    const row = loginRows.find((group) => group.some((other) => overlaps(other, item)));
    if (row) row.push(item);
    else loginRows.push([item]);
  }
  for (const row of loginRows) {
    expect(sameLine(row)).toBe(true);
    expect(noHorizontalOverlap(row)).toBe(true);
  }

  const account = await boxes(page, '.account-row > *');
  if (account.length >= 2) {
    for (let i = 1; i < account.length; i += 1) {
      expect(overlaps(account[0], account[i])).toBe(true);
    }
    expect(noHorizontalOverlap(account)).toBe(true);
  }

  const controls = await boxes(
    page,
    '.mode-badge, .account-name, .account-logout, .gsi-slot, .account-alt, .mast-actions button',
  );
  expect(controls.length).toBeGreaterThan(0);
  const rows: Box[][] = [];
  for (const control of controls) {
    const row = rows.find((group) => group.some((item) => overlaps(item, control)));
    if (row) row.push(control);
    else rows.push([control]);
  }
  expect(rows.length).toBeLessThanOrEqual(2);
  for (const row of rows) expect(noHorizontalOverlap(row)).toBe(true);

  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shot(page: Page, name: string): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  const device = width <= 500 ? 'iphone' : 'pc';
  await page.screenshot({
    path: `screenshots/header_${name}_${device}_${width}.png`,
    animations: 'disabled',
  });
}

test('signed-out header lines up', async ({ page }) => {
  await openMock(page, 'signed-out');
  await expect(page.getByRole('button', { name: '別の方法でログイン' })).toBeVisible();
  await expect(page.locator('.gsi-placeholder')).toBeVisible();
  await expect(page.getByRole('button', { name: '追加' })).toBeHidden();
  await expect(page.getByRole('button', { name: '保管', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notionに保管' })).toBeHidden();
  await expectHeaderLayout(page);
  await shot(page, 'signed_out');
});

test('signed-in editor header lines up', async ({ page }) => {
  await openMock(page, 'editor');
  await expect(page.locator('.mode-badge')).toHaveText('共有');
  await expect(page.locator('.account-name')).toHaveText('ちひろ');
  await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible();
  await expect(page.getByRole('button', { name: '追加' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notionに保管' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保管', exact: true })).toBeVisible();
  await expectHeaderLayout(page);
  await shot(page, 'editor');
});

test('signed-in read-only header lines up', async ({ page }) => {
  await openMock(page, 'viewer');
  await expect(page.locator('.mode-badge')).toHaveText('見るだけ');
  await expect(page.locator('.account-name')).toHaveText('ちひろ');
  await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible();
  await expect(page.getByRole('button', { name: '追加' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Notionに保管' })).toBeHidden();
  await expect(page.getByRole('button', { name: '保管', exact: true })).toBeVisible();
  await expectHeaderLayout(page);
  await shot(page, 'viewer');
});

test('a long name stays on the account line', async ({ page }) => {
  await openMock(page, 'long');
  const name = page.locator('.account-name');
  await expect(name).toBeVisible();
  const clipped = await name.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  const width = page.viewportSize()?.width ?? 0;
  if (width <= 500) expect(clipped).toBe(true);
  await expectHeaderLayout(page);
  await shot(page, 'long');
});

test('mock editor writes locally and does not call Firebase', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await openMock(page, 'editor');
  await page.getByRole('button', { name: '追加' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('本文').fill('ヘッダの見本');
  await dialog.locator('input[name="scene"]').fill('画面');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('ヘッダの見本')).toBeVisible();
  const saved = await page.evaluate(() => localStorage.getItem('dajareVault:v1'));
  expect(saved).toContain('ヘッダの見本');
  const joined = urls.join('\n');
  expect(joined).not.toMatch(
    /firestore\.googleapis|identitytoolkit|securetoken|firebaseapp\.com|accounts\.google\.com/,
  );
});
