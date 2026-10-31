import { expect, test, type Page } from '@playwright/test';

async function fresh(page: Page): Promise<void> {
  await page.goto('/dajare-vault/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
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

test('search', async ({ page }) => {
  await fresh(page);
  await page.getByPlaceholder('検索').fill('いくら');
  await expect(page.locator('dajare-card')).toHaveCount(1);
  await shot(page, 'search');
});
