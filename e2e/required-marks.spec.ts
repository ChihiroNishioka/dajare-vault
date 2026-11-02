import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

const optional = ['reading', 'source', 'memo', 'addedAt', 'addedAtNote'] as const;

function shotDirs(): string[] {
  const dirs: string[] = [];
  for (const dir of ['/opt/cursor/artifacts/screenshots', 'screenshots']) {
    try {
      mkdirSync(dir, { recursive: true });
      dirs.push(dir);
    } catch {
      // この環境に書けない場所は飛ばす。
    }
  }
  return dirs;
}

async function shot(page: Page, name: string): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  const device = width <= 500 ? 'iphone-390' : 'pc-1280';
  await Promise.all(
    shotDirs().map((dir) =>
      page.screenshot({
        path: `${dir}/required_${name}_${device}.png`,
        animations: 'disabled',
        fullPage: true,
      }),
    ),
  );
}

async function openEditor(page: Page): Promise<void> {
  await page.goto('/dajare-vault/?mock=editor');
  await page.evaluate(() => localStorage.clear());
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
  await expect(dialog.getByRole('img', { name: '必須' })).toHaveCount(2);
  for (const name of ['text', 'scene'] as const) {
    const label = labelFor(dialog, name);
    await expect(label.getByRole('img', { name: '必須' })).toBeVisible();
    await expect(dialog.locator(`[name="${name}"]`)).toHaveAttribute('aria-required', 'true');
    expect(await sameLine(label)).toBe(true);
    const color = await label.locator('.req').evaluate((node) => getComputedStyle(node).color);
    const [red, green, blue] = color.match(/\d+/g)?.map(Number) ?? [];
    expect(red ?? 0).toBeGreaterThan((green ?? 0) + 40);
    expect(red ?? 0).toBeGreaterThan((blue ?? 0) + 40);
  }
  for (const name of optional) {
    await expect(labelFor(dialog, name).getByRole('img', { name: '必須' })).toHaveCount(0);
    await expect(dialog.locator(`[name="${name}"]`)).not.toHaveAttribute('aria-required', 'true');
  }
  await expect(
    dialog.getByRole('group', { name: '言った人' }).getByRole('img', { name: '必須' }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole('group', { name: 'タグ' }).getByRole('img', { name: '必須' }),
  ).toHaveCount(0);

  const legend = await dialog.getByText('＊は必須', { exact: true }).boundingBox();
  const text = await dialog.locator('textarea[name="text"]').boundingBox();
  expect(legend && text && legend.y < text.y).toBe(true);

  await shot(page, shotName);

  await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled();
  await dialog.locator('textarea[name="text"]').fill('   ');
  await dialog.locator('textarea[name="text"]').blur();
  await expect(dialog.getByText('本文を書いてください')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled();
  await expect(dialog).toBeVisible();
}

test('signed-out visitors cannot open the add form', async ({ page }) => {
  await page.goto('/dajare-vault/?mock=signed-out');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/dajare-vault/?mock=signed-out');
  await expect(page.locator('dajare-card').first()).toBeVisible();
  await expect(page.locator('.masthead').getByRole('button', { name: '追加' })).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a signed-in mock add form marks only the required fields', async ({ page }) => {
  await openEditor(page);
  const dialog = await openAdd(page);
  await expectRequiredForm(page, dialog, 'mock');
});

test('local mode add form marks only the required fields', async ({ page }) => {
  await openLocal(page);
  const dialog = await openAdd(page);
  await expectRequiredForm(page, dialog, 'local');
});
