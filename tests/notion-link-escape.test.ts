// @vitest-environment jsdom
// 入口の safeNotionUrl を素通しに差し替え、panel の href の escapeHtml だけを確かめる。
// 本物の safeNotionUrl は引用符を含む値を先に弾くので、差し替えないと escapeHtml に届かない。
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/notion/notion-url', () => ({
  safeNotionUrl: (value: unknown) => (typeof value === 'string' ? value : null),
}));

const { notionPanel } = await import('../src/ui/panel');

describe('notion link href escaping', () => {
  it('keeps quotes and tags inside the href when the entry check lets them through', () => {
    const raw = `https://www.notion.so/x" onclick="alert(1)' data-x='1&amp;<b>bold</b>`;
    const root = document.createElement('div');
    root.innerHTML = notionPanel('done', '新しく 1 件', { notionUrl: raw });
    const links = root.querySelectorAll('a');
    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link.getAttributeNames().sort()).toEqual(
      ['class', 'data-notion-link', 'href', 'rel', 'target'].sort(),
    );
    expect(link.getAttribute('href')).toBe(raw);
    expect(link.textContent?.trim()).toBe('Notionで開く');
    expect(root.querySelector('[onclick]')).toBeNull();
    expect(root.querySelector('[data-x]')).toBeNull();
    expect(root.querySelector('b')).toBeNull();
  });
});
