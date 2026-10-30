// ===== Twelve Data: 日足 OHLCV =====
// 無料プラン: 8 回/分, 800 回/日 (米国株)
// https://twelvedata.com/docs#time-series

import type { Candle } from '../types';
import { marketSession } from '../market';
import { ApiError, RateLimiter, cacheGet, cacheSet, getJson } from './http';

const limiter = new RateLimiter(7, 60_000);

interface TdResp {
  status: 'ok' | 'error';
  code?: number;
  message?: string;
  values?: { datetime: string; open: string; high: string; low: string; close: string; volume: string }[];
}

/** 取引時間中は 5 分, それ以外は 1 時間キャッシュ */
const ttl = () => (marketSession() === 'regular' ? 5 * 60_000 : 60 * 60_000);

export async function tdDaily(symbol: string, key: string, force = false): Promise<{ candles: Candle[]; fetchedAt: number }> {
  const ck = `td-daily:${symbol}`;
  if (!force) {
    const c = cacheGet<Candle[]>(ck, ttl());
    if (c) return { candles: c.value, fetchedAt: c.at };
  }
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=420&order=ASC&timezone=America/New_York&apikey=${encodeURIComponent(key)}`;
  const r = await limiter.schedule(() => getJson<TdResp>(url, 'Twelve Data'));
  if (r.status !== 'ok' || !r.values) {
    if (r.code === 429) throw new ApiError('Twelve Data のレート上限 (8回/分) に到達。1分後に再試行します', 'Twelve Data', 429);
    throw new ApiError(r.message ?? '日足を取得できません', 'Twelve Data', r.code);
  }
  const candles: Candle[] = r.values.map((v) => ({
    time: v.datetime.slice(0, 10),
    open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +v.volume || 0,
  }));
  // 重複日の除去と昇順保証
  const uniq = Array.from(new Map(candles.map((c) => [c.time, c])).values()).sort((a, b) => (a.time < b.time ? -1 : 1));
  cacheSet(ck, uniq);
  return { candles: uniq, fetchedAt: Date.now() };
}
