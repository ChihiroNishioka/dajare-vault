import { expect, test, type Page } from '@playwright/test';

async function fresh(page: Page): Promise<void> {
  await page.goto('/dajare-vault/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('dajare-card').first()).toBeVisible();
}

async function shot(page: Page, name: string): Promise<void> {
  const viewport = page.viewportSize();
  const width = viewport?.width ?? 0;
  const device = width <= 500 ? 'iphone' : 'pc';
  await page.screenshot({
    path: `screenshots/${name}_${device}_${width}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

test.describe.configure({ timeout: 120_000 });

test('list', async ({ page }) => {
  await fresh(page);
  await shot(page, 'list');
});

test('add', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: '追加' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot(page, 'add');
});

test('edit', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: '編集' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot(page, 'edit');
});

async function shotViewport(page: Page, name: string): Promise<void> {
  const viewport = page.viewportSize();
  const width = viewport?.width ?? 0;
  const device = width <= 500 ? 'iphone' : 'pc';
  await page.screenshot({
    path: `screenshots/${name}_${device}_${width}.png`,
    animations: 'disabled',
  });
}

test('share local', async ({ page }) => {
  await page.goto('/dajare-vault/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByText('この端末だけ')).toBeVisible();
  await shotViewport(page, 'share_local');
});

test('share editor', async ({ page }) => {
  await page.goto('/dajare-vault/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'dajareVault:previewActor',
      JSON.stringify({ uid: 'preview-hanako', email: 'hanako@example.com', name: '花子' }),
    );
  });
  await page.reload();
  await expect(page.getByText('花子')).toBeVisible();
  await page.getByRole('button', { name: '追加' }).click();
  await page.getByRole('dialog').getByLabel('本文').fill('家族で共有する試し');
  await page.locator('#dajare-form input[name="scene"]').fill('食卓');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('書いた人')).toBeVisible();
  await page.evaluate(() => {
    const toast = document.querySelector('#toast');
    if (toast) toast.textContent = '';
    window.scrollTo(0, 0);
  });
  await shotViewport(page, 'share_editor');
});

test('search', async ({ page }) => {
  await fresh(page);
  await page.getByPlaceholder('検索').fill('いくら');
  await expect(page.locator('dajare-card')).toHaveCount(1);
  await shot(page, 'search');
});
