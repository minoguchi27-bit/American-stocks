// ===== レート制限付き fetch とキャッシュ =====

export class RateLimiter {
  private stamps: number[] = [];
  private chain: Promise<void> = Promise.resolve();
  constructor(private max: number, private windowMs: number) {}

  /** スライディングウィンドウ方式。上限到達時は空きが出るまで待機 */
  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      for (;;) {
        const now = Date.now();
        this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
        if (this.stamps.length < this.max) break;
        await new Promise((r) => setTimeout(r, this.windowMs - (now - this.stamps[0]) + 25));
      }
      this.stamps.push(Date.now());
    });
    this.chain = run.catch(() => undefined);
    return run.then(fn);
  }
}

export class ApiError extends Error {
  constructor(message: string, public provider: string, public status?: number) {
    super(message);
  }
}

export async function getJson<T>(url: string, provider: string, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (res.status === 429) throw new ApiError('API レート上限に到達しました。しばらく待って再試行してください', provider, 429);
    if (res.status === 401 || res.status === 403) throw new ApiError('API キーが無効、またはこのデータへのアクセス権がありません', provider, res.status);
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, provider, res.status);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error).name === 'AbortError') throw new ApiError('タイムアウト', provider);
    throw new ApiError(`通信エラー: ${(e as Error).message}`, provider);
  } finally {
    clearTimeout(timer);
  }
}

// localStorage キャッシュ (値と保存時刻)
const PREFIX = 'usx-cache:';

export function cacheGet<T>(key: string, ttlMs: number): { value: T; at: number } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw) as { value: T; at: number };
    if (Date.now() - obj.at > ttlMs) return null;
    return obj;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, value: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ value, at: Date.now() }));
  } catch {
    // 容量超過時は古いキャッシュを全削除
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
    } catch { /* noop */ }
  }
}

export function cacheClear() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* noop */ }
}
