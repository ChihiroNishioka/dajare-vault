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

/** Worker の中で待つ上限。これより長い Retry-After はブラウザへ返す。 */
export const MAX_INLINE_WAIT_MS = 3_000;
export const MAX_CLIENT_WAIT_MS = 60_000;
/** 認証の2回を残して、1呼び出しのサブリクエストを50未満に収める。 */
export const NOTION_SUBREQUEST_BUDGET = 40;

export function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const headerSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
    return Math.min(headerSeconds * 1000, MAX_CLIENT_WAIT_MS);
  }
  return Math.min(400 * 2 ** attempt, 8_000);
}

export class RetryLater extends Error {
  constructor(readonly ms: number) {
    super('retry-later');
  }
}

export class BudgetStop extends Error {
  constructor() {
    super('budget');
  }
}

export class SubrequestBudget {
  used = 0;
  constructor(readonly limit = NOTION_SUBREQUEST_BUDGET) {}
  take(): void {
    if (this.used >= this.limit) throw new BudgetStop();
    this.used += 1;
  }
}
