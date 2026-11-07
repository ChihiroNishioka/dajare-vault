// 仕様の値（許可ホスト www.notion.so と notion.so）は定義から読まず、ここに文字で書く。
import { describe, expect, it } from 'vitest';
import { notionUrlFromId, safeNotionUrl } from '../src/notion/notion-url';

const ID = '0123456789abcdef0123456789abcdef';

describe('safeNotionUrl', () => {
  it('accepts a Notion database URL on www.notion.so and notion.so', () => {
    expect(safeNotionUrl(`https://www.notion.so/${ID}`)).toBe(`https://www.notion.so/${ID}`);
    expect(safeNotionUrl(`https://notion.so/${ID}`)).toBe(`https://notion.so/${ID}`);
    expect(safeNotionUrl(`https://www.notion.so/dajare-${ID}`)).toBe(
      `https://www.notion.so/dajare-${ID}`,
    );
    expect(safeNotionUrl(`https://www.notion.so:443/${ID}`)).toBe(`https://www.notion.so/${ID}`);
  });

  it('rejects hosts other than www.notion.so and notion.so', () => {
    for (const value of [
      `https://evil.example/${ID}`,
      `https://www.notion.so.evil.example/${ID}`,
      `https://evil-notion.so/${ID}`,
      `https://notion.so./${ID}`,
      `https://api.notion.so/${ID}`,
    ]) {
      expect(safeNotionUrl(value), value).toBeNull();
    }
  });

  it('rejects anything that is not an absolute https URL', () => {
    for (const value of [
      `http://www.notion.so/${ID}`,
      'javascript:alert(1)',
      'data:text/html,x',
      `//www.notion.so/${ID}`,
      `/${ID}`,
    ]) {
      expect(safeNotionUrl(value), value).toBeNull();
    }
  });

  it('rejects user info, an unusual port, a query and a fragment', () => {
    expect(safeNotionUrl(`https://user:pw@www.notion.so/${ID}`)).toBeNull();
    expect(safeNotionUrl(`https://www.notion.so:8443/${ID}`)).toBeNull();
    expect(safeNotionUrl(`https://www.notion.so/${ID}?token=x`)).toBeNull();
    expect(safeNotionUrl(`https://www.notion.so/${ID}#x`)).toBeNull();
    expect(safeNotionUrl(`https://www.notion.so/${ID}?`)).toBeNull();
  });

  it('rejects paths that are not a Notion id and values that are not short strings', () => {
    expect(safeNotionUrl('https://www.notion.so/../etc')).toBeNull();
    expect(safeNotionUrl('https://www.notion.so/not-an-id')).toBeNull();
    expect(safeNotionUrl(`https://www.notion.so/${ID}/x`)).toBeNull();
    const at200 = `https://www.notion.so/${'a'.repeat(200 - 'https://www.notion.so/'.length - 33)}-${ID}`;
    expect(at200).toHaveLength(200);
    expect(safeNotionUrl(at200)).toBe(at200);
    const at201 = `https://www.notion.so/${'a'.repeat(201 - 'https://www.notion.so/'.length - 33)}-${ID}`;
    expect(at201).toHaveLength(201);
    expect(safeNotionUrl(at201)).toBeNull();
    for (const value of ['', null, undefined, 42, { href: `https://www.notion.so/${ID}` }]) {
      expect(safeNotionUrl(value)).toBeNull();
    }
  });
});

describe('notionUrlFromId', () => {
  it('builds www.notion.so with 32 lowercase hex digits and refuses a non-Notion id', () => {
    expect(notionUrlFromId('0123ABCD-89ab-cdef-0123-456789ABCDEF')).toBe(
      'https://www.notion.so/0123abcd89abcdef0123456789abcdef',
    );
    expect(notionUrlFromId(ID)).toBe(`https://www.notion.so/${ID}`);
    expect(notionUrlFromId('db-1')).toBeNull();
    expect(notionUrlFromId('../secret')).toBeNull();
  });
});
