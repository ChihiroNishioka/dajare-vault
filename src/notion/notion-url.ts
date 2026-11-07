import { isNotionId } from './plan';

/** 保管先のリンクに使ってよいホスト。足すときは仕様を直してから。 */
export const NOTION_LINK_HOSTS: readonly string[] = ['www.notion.so', 'notion.so'];

const NOTION_PATH = /^\/(?:[A-Za-z0-9-]+-)?[0-9a-f]{32}$/;

/** Worker とブラウザの両方で使う。許可した形の Notion の URL だけを正規化して返す。 */
export function safeNotionUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!NOTION_LINK_HOSTS.includes(url.hostname)) return null;
  if (url.username || url.password || url.port) return null;
  if (url.search || url.hash || /[?#]/.test(value)) return null;
  if (!NOTION_PATH.test(url.pathname)) return null;
  return url.href;
}

/** Worker が自分で見つけたデータベース id から URL を組み立てる。 */
export function notionUrlFromId(id: string): string | null {
  if (!isNotionId(id)) return null;
  return safeNotionUrl(`https://www.notion.so/${id.replaceAll('-', '').toLowerCase()}`);
}
