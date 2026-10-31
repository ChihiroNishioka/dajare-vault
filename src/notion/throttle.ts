/** Notion の目安（毎秒3回）より少し遅く間隔を空ける。 */
export const NOTION_MIN_INTERVAL_MS = 340;

export function createLimiter(
  intervalMs: number,
  sleep: (ms: number) => Promise<void>,
  now = Date.now,
) {
  let nextAt = 0;
  return async function limit(): Promise<void> {
    const current = now();
    const wait = Math.max(0, nextAt - current);
    nextAt = Math.max(current, nextAt) + intervalMs;
    if (wait > 0) await sleep(wait);
  };
}

export function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const headerSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
    return Math.min(headerSeconds * 1000, 10_000);
  }
  return Math.min(400 * 2 ** attempt, 8_000);
}
