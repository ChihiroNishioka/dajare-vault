import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

const optional = ['reading', 'source', 'memo', 'addedAt', 'addedAtNote'] as const;

function shotDir(): string {
  const dir = process.env.SCREENSHOT_DIR ?? 'screenshots';
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  const device = width <= 500 ? 'iphone-390' : 'pc-1280';
  await page.screenshot({
    path: `${shotDir()}/required_${name}_${device}.png`,
    animations: 'disabled',
    fullPage,
  });
}

async function openEditor(page: Page): Promise<void> {
  await page.goto('/dajare-vault/?mock=editor');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('dajare-card').first()).toBeVisible();
  await expect(page.locator('.account-name')).toHaveText('ちひろ');
}

async function openLocal(page: Page): Promise<void> {
  await page.goto('/dajare-vault/');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('dajare-card').first()).toBeVisible();
  await expect(page.locator('.mode-badge')).toHaveText('この端末だけ');
}

async function openAdd(page: Page): Promise<Locator> {
  await page.locator('.masthead').getByRole('button', { name: '追加' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '紙を足す' })).toBeVisible();
  return dialog;
}

function labelFor(dialog: Locator, name: string): Locator {
  return dialog.locator(`label:has([name="${name}"])`);
}

async function sameLine(label: Locator): Promise<boolean> {
  return label.evaluate((node) => {
    const name = node.querySelector('.field-name');
    const star = node.querySelector('.req');
    if (!name || !star) return false;
    const text = [...name.childNodes].find((child) => child.nodeType === Node.TEXT_NODE);
    if (!text) return false;
    const range = document.createRange();
    range.selectNodeContents(text);
    const textTop = range.getBoundingClientRect().top;
    const starTop = star.getBoundingClientRect().top;
    return Math.abs(textTop - starTop) <= 2;
  });
}

async function expectRequiredForm(page: Page, dialog: Locator, shotName: string): Promise<void> {
  await expect(dialog.getByText('＊は必須', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('img', { name: '必須' })).toHaveCount(0);
  const requiredNames = await dialog
    .locator('[aria-required="true"]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).name));
  expect(requiredNames.length).toBeGreaterThan(0);
  for (const name of requiredNames) {
    const label = labelFor(dialog, name);
    const star = label.locator('.req');
    const input = dialog.locator(`[name="${name}"]`);
    await expect(star).toHaveText('＊');
    await expect(star).toHaveAttribute('aria-hidden', 'true');
    await expect(input).toHaveAttribute('aria-required', 'true');
    await expect(dialog.locator(`[data-error-for="${name}"]`)).toHaveAttribute(
      'aria-live',
      'polite',
    );
    await expect(input).not.toHaveAccessibleName(/必須/);
    const describedBy = (await input.getAttribute('aria-describedby')) ?? '';
    expect(describedBy).not.toBe('');
    await expect(dialog.locator(`[id="${describedBy}"]`)).toHaveAttribute('data-error-for', name);
    expect(await sameLine(label)).toBe(true);
    const color = await star.evaluate((node) => getComputedStyle(node).color);
    const [red, green, blue] = color.match(/\d+/g)?.map(Number) ?? [];
    expect(red ?? 0).toBeGreaterThan((green ?? 0) + 40);
    expect(red ?? 0).toBeGreaterThan((blue ?? 0) + 40);
  }
  for (const name of optional) {
    await expect(labelFor(dialog, name).locator('.req')).toHaveCount(0);
    await expect(dialog.locator(`[name="${name}"]`)).not.toHaveAttribute('aria-required', 'true');
  }
  for (const legend of ['言った人', 'タグ']) {
    await expect(dialog.getByRole('group', { name: legend }).locator('.req')).toHaveCount(0);
  }

  const legend = await dialog.getByText('＊は必須', { exact: true }).boundingBox();
  const text = await dialog.locator('textarea[name="text"]').boundingBox();
  expect(legend && text && legend.y < text.y).toBe(true);

  await shot(page, shotName, true);

  await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled();
  await dialog.locator('textarea[name="text"]').fill('   ');
  await dialog.locator('textarea[name="text"]').blur();
  await expect(dialog.getByText('本文を書いてください')).toBeVisible();
  await expect(dialog.locator('textarea[name="text"]')).toHaveAccessibleDescription(
    '本文を書いてください',
  );
  await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled();
  await expect(dialog).toBeVisible();
  await expectEachRequiredFieldBlocksSave(dialog);
}

async function expectEachRequiredFieldBlocksSave(dialog: Locator): Promise<void> {
  const names = await dialog
    .locator('[aria-required="true"]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).name));
  expect(names.length).toBeGreaterThan(1);
  for (const emptyName of names) {
    for (const name of names) {
      const input = dialog.locator(`[name="${name}"]`);
      await input.fill(name === emptyName ? '' : 'あり');
      await input.blur();
    }
    await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled();
    await expect(dialog.locator(`[data-error-for="${emptyName}"]`)).toHaveText(/.+/);
    for (const other of names) {
      if (other === emptyName) continue;
      await expect(dialog.locator(`[data-error-for="${other}"]`)).toHaveText('');
    }
  }
}

test('signed-out visitors cannot open the add form', async ({ page }) => {
  await page.goto('/dajare-vault/?mock=signed-out');
  await expect(page.locator('dajare-card').first()).toBeVisible();
  await expect(page.locator('.masthead').getByRole('button', { name: '追加' })).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a signed-in mock add form marks only the required fields', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('.mode-badge')).toHaveText('共有');
  await expect(page.locator('.account-name')).toHaveText('ちひろ');
  await shot(page, 'mock-header');
  const dialog = await openAdd(page);
  await expectRequiredForm(page, dialog, 'mock');
});

test('the edit form marks the same required fields', async ({ page }) => {
  await openLocal(page);
  await page.locator('dajare-card').first().getByRole('button', { name: '編集' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '書き直す' })).toBeVisible();
  await expect(dialog.getByText('＊は必須', { exact: true })).toBeVisible();
  await expect(dialog.locator('[aria-required="true"]')).toHaveCount(2);
  for (const name of ['text', 'scene']) {
    const label = labelFor(dialog, name);
    await expect(label.locator('.req')).toHaveText('＊');
    await expect(label.locator('.req')).toHaveAttribute('aria-hidden', 'true');
  }
  await expect(dialog.locator('textarea[name="text"]')).toHaveAttribute('aria-required', 'true');
  await expect(dialog.locator('input[name="scene"]')).toHaveAttribute('aria-required', 'true');
  await expect(dialog.locator('[data-error-for="text"]')).toHaveAttribute('aria-live', 'polite');
});

test('local mode add form marks only the required fields', async ({ page }) => {
  await openLocal(page);
  await expect(page.locator('.mode-badge')).toHaveText('この端末だけ');
  await expect(page.locator('.account-name')).toHaveCount(0);
  await shot(page, 'local-header');
  const dialog = await openAdd(page);
  await expectRequiredForm(page, dialog, 'local');
});
