import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const seed = JSON.parse(
  readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'),
) as {
  items: unknown[];
};

async function fresh(page: Page): Promise<void> {
  await page.goto('/dajare-vault/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('dajare-card')).toHaveCount(seed.items.length);
}

async function ensureFilters(page: Page): Promise<void> {
  const sort = page.getByLabel('並び替え');
  if (await sort.isVisible()) return;
  await page.getByRole('button', { name: '絞り込みを開く' }).click();
  await expect(sort).toBeVisible();
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await fresh(page);
});

test('lists the seed, keeps a new pun after reload, and blocks an empty save', async ({ page }) => {
  await expect(page).toHaveTitle('駄洒落保管庫');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const script = await page.locator('script[type="module"]').getAttribute('src');
  expect(script).toContain('/dajare-vault/');
  await expect(page.getByText('イクラはいくら？')).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: '追加' }).click();
  await expectNoHorizontalScroll(page);
  await expect(page.getByRole('button', { name: '保存' })).toBeDisabled();
  await page.getByRole('dialog').getByLabel('本文').fill('   ');
  await page.getByRole('dialog').getByLabel('本文').blur();
  await expect(page.getByText('本文を書いてください')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存' })).toBeDisabled();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('本文').fill('新しい駄洒落のテスト');
  await dialog.locator('input[name="scene"]').fill('テストの場面');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('新しい駄洒落のテスト')).toBeVisible();
  await page.reload();
  await expect(page.getByText('新しい駄洒落のテスト')).toBeVisible();
  await expect(page.locator('dajare-card')).toHaveCount(seed.items.length + 1);
  await expect(page.getByText('布団がふっとんだ')).toBeVisible();
});

test('a second tap on save does not add another pun', async ({ page }) => {
  await page.getByRole('button', { name: '追加' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('本文').fill('二度押しの試し');
  await dialog.locator('input[name="scene"]').fill('場面');
  await page.getByRole('button', { name: '保存' }).dblclick();
  await expect(page.getByText('二度押しの試し')).toHaveCount(1);
  await expect(page.locator('dajare-card', { hasText: '二度押しの試し' })).toHaveCount(1);
});

test('edits a pun and refreshes updatedAt', async ({ page }) => {
  const card = page.locator('dajare-card', { hasText: 'イクラはいくら？' });
  const before = await card.locator('time.updated').getAttribute('datetime');
  await card.getByRole('button', { name: '編集' }).click();
  await expectNoHorizontalScroll(page);
  await page.getByRole('dialog').locator('textarea[name="memo"]').fill('単価を聞いた');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('単価を聞いた')).toBeVisible();
  const after = await page
    .locator('dajare-card', { hasText: 'イクラはいくら？' })
    .locator('time.updated')
    .getAttribute('datetime');
  expect(after).not.toBe(before);
  expect(after).toBeTruthy();
});

test('form fields stay at least 16px so iOS does not zoom', async ({ page }) => {
  await page.getByRole('button', { name: '追加' }).click();
  const names = ['text', 'scene', 'reading', 'source', 'addedAtNote', 'memo'];
  for (const name of names) {
    const size = await page
      .locator(`#dajare-form [name="${name}"]`)
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  }
});

test('deletes through the confirm dialog and stays gone after reload', async ({ page }) => {
  const card = page.locator('dajare-card', { hasText: '電話に出んわ' });
  await card.getByRole('button', { name: '編集' }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await page.getByRole('button', { name: '削除する' }).click();
  await expect(page.getByText('電話に出んわ')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('電話に出んわ')).toHaveCount(0);
  await expect(page.locator('dajare-card')).toHaveCount(seed.items.length - 1);
});

test('searches, filters, and sorts', async ({ page }) => {
  await page.getByPlaceholder('検索').fill('いくら');
  await expect(page.locator('dajare-card')).toHaveCount(1);
  await expect(page.getByText('イクラはいくら？')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByPlaceholder('検索').fill('');

  await ensureFilters(page);
  await page.getByLabel('シーンで絞る').fill('回転寿司');
  await expect(page.locator('dajare-card')).toHaveCount(1);
  await page.getByLabel('シーンで絞る').fill('');

  await page.locator('#tag-list').getByRole('button', { name: '食べ物', exact: true }).click();
  await expect(page.locator('dajare-card')).toHaveCount(3);
  await page.getByLabel('タグの条件').selectOption('and');
  await page.locator('#tag-list').getByRole('button', { name: '寿司', exact: true }).click();
  await expect(page.locator('dajare-card')).toHaveCount(1);

  await page.locator('#tag-list').getByRole('button', { name: '食べ物', exact: true }).click();
  await page.locator('#tag-list').getByRole('button', { name: '寿司', exact: true }).click();
  await page.locator('#speaker-list').getByRole('button', { name: 'パパ', exact: true }).click();
  await expect(page.getByText('水曜はどうすぃようねぇ')).toBeVisible();
  await expect(page.getByText('イクラはいくら？')).toHaveCount(0);

  await page.locator('#speaker-list').getByRole('button', { name: 'パパ', exact: true }).click();
  await page.getByLabel('並び替え').selectOption('reading');
  await expect(page.locator('dajare-card').first()).toContainText('アルミ缶の上にあるミカン');
  await page.getByLabel('並び替え').selectOption('ratingDesc');
  await expect(page.locator('dajare-card').first()).toContainText('イクラはいくら？');
  await page.getByLabel('並び替え').selectOption('addedAsc');
  await expect(page.locator('dajare-card').first()).toContainText('レース付きドレスレース');
});

test('exports json and shows the duplicate dialog on import', async ({ page }) => {
  await page.getByRole('button', { name: '保管' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '書き出す' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^dajare-vault-\d{8}-\d{4}\.json$/);
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.locator('input[type="file"]').setInputFiles(path!);
  await expect(page.getByText(/同じIDが/)).toBeVisible();
  await page.getByRole('button', { name: '取り込む' }).click();
  await expect(page.getByRole('status')).toContainText('スキップ');
  await expect(page.locator('dajare-card')).toHaveCount(seed.items.length);
});
