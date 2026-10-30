import { describe, expect, it } from 'vitest';
import { atr, bollinger, ema, macd, rsi, sma } from './indicators';
import { entryPlan, fundamentalScore, holdPlan, levelOf, mergeLiveQuote, techSnapshot, technicalScore, verdict } from './analysis';
import { checkIntegrity } from './integrity';
import { isTradingDay, lastTradingDate, marketSession, tradingDaysBetween } from './market';
import type { Candle, Fundamentals, Quote } from './types';

function series(n: number, f: (i: number) => number, endDate = '2026-10-29'): Candle[] {
  const dates: string[] = [];
  let d = new Date(endDate + 'T12:00:00Z');
  while (dates.length < n) {
    const s = d.toISOString().slice(0, 10);
    if (isTradingDay(s)) dates.unshift(s);
    d = new Date(d.getTime() - 86400000);
  }
  return dates.map((time, i) => {
    const c = f(i);
    return { time, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1e6 };
  });
}

describe('indicators', () => {
  it('sma / ema', () => {
    expect(sma([1, 2, 3, 4, 5], 3).slice(2)).toEqual([2, 3, 4]);
    const e = ema([1, 2, 3, 4, 5, 6], 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBe(3);
  });
  it('rsi: 単調増加は 100, 単調減少は 0', () => {
    const up = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(rsi(up).at(-1)).toBe(100);
    expect(rsi(up.slice().reverse()).at(-1)).toBe(0);
  });
  it('rsi: Wilder 既知値 (14期間)', () => {
    // 古典的な Wilder のサンプル
    const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(c)[14]).toBeCloseTo(70.46, 1);
  });
  it('bollinger: 一定値なら幅 0', () => {
    const b = bollinger(Array(30).fill(10));
    expect(b.upper.at(-1)).toBe(10);
    expect(b.lower.at(-1)).toBe(10);
  });
  it('atr: 一定レンジ', () => {
    const h = Array(30).fill(11), l = Array(30).fill(9), c = Array(30).fill(10);
    expect(atr(h, l, c).at(-1)).toBeCloseTo(2);
  });
  it('macd: 上昇トレンドで正', () => {
    const m = macd(Array.from({ length: 60 }, (_, i) => 100 + i));
    expect(m.line.at(-1)!).toBeGreaterThan(0);
  });
});

describe('market calendar', () => {
  it('休場日と週末', () => {
    expect(isTradingDay('2026-11-26')).toBe(false); // Thanksgiving
    expect(isTradingDay('2026-10-31')).toBe(false); // Sat
    expect(isTradingDay('2026-10-30')).toBe(true);
  });
  it('セッション判定 (NY 時間)', () => {
    expect(marketSession(Date.parse('2026-10-30T14:00:00Z'))).toBe('regular'); // 10:00 ET
    expect(marketSession(Date.parse('2026-10-30T12:00:00Z'))).toBe('pre');
    expect(marketSession(Date.parse('2026-10-30T21:00:00Z'))).toBe('post');
    expect(marketSession(Date.parse('2026-10-31T15:00:00Z'))).toBe('closed');
    expect(marketSession(Date.parse('2026-11-27T18:30:00Z'))).toBe('post'); // 短縮取引 13:00 ET
  });
  it('直近営業日', () => {
    expect(lastTradingDate(Date.parse('2026-10-31T15:00:00Z'))).toBe('2026-10-30');
    expect(lastTradingDate(Date.parse('2026-10-30T12:00:00Z'))).toBe('2026-10-29');
    expect(tradingDaysBetween('2026-10-23', '2026-10-30')).toBe(5);
  });
});

const fund = (p: Partial<Fundamentals>): Fundamentals => ({
  symbol: 'X', name: null, sector: null, marketCap: null, peTTM: null, forwardPE: null, pegTTM: null, psTTM: null, pbQ: null,
  epsGrowthTTMYoy: null, revenueGrowthTTMYoy: null, epsGrowth5Y: null, roeTTM: null, netMarginTTM: null, grossMarginTTM: null,
  debtToEquity: null, currentRatio: null, fcfMarginTTM: null, dividendYield: null, beta: null, week52High: null, week52Low: null,
  analyst: null, nextEarnings: null, epsSurprises: [], fetchedAt: 0, source: 'demo', ...p,
});

describe('scoring', () => {
  it('200本未満は判定保留', () => {
    expect(techSnapshot(series(150, (i) => 100 + i))).toBeNull();
    expect(technicalScore(null).value).toBeNull();
  });
  it('上昇トレンドは高スコア / 下降トレンドは低スコア', () => {
    const up = technicalScore(techSnapshot(series(300, (i) => 100 * 1.003 ** i + Math.sin(i) * 0.5)));
    const dn = technicalScore(techSnapshot(series(300, (i) => 300 * 0.997 ** i + Math.sin(i) * 0.5)));
    expect(up.value!).toBeGreaterThan(55);
    expect(dn.value!).toBeLessThan(45);
  });
  it('ファンダ: 優良と赤字', () => {
    const good = fundamentalScore(fund({ pegTTM: 0.9, peTTM: 22, revenueGrowthTTMYoy: 30, epsGrowthTTMYoy: 35, roeTTM: 30, netMarginTTM: 25, debtToEquity: 0.3, currentRatio: 2 }));
    const bad = fundamentalScore(fund({ peTTM: -5, revenueGrowthTTMYoy: -15, epsGrowthTTMYoy: -40, roeTTM: -10, netMarginTTM: -8, debtToEquity: 4, currentRatio: 0.7 }));
    expect(good.value!).toBeGreaterThan(85);
    expect(bad.value!).toBeLessThan(15);
  });
  it('ファンダ: カバレッジ不足は保留', () => {
    expect(fundamentalScore(fund({ peTTM: 20 })).value).toBeNull();
  });
  it('レベル境界', () => {
    expect(levelOf(72)).toBe('STRONG_BUY');
    expect(levelOf(58)).toBe('BUY');
    expect(levelOf(50)).toBe('HOLD');
    expect(levelOf(42)).toBe('SELL');
    expect(levelOf(28)).toBe('STRONG_SELL');
  });
  it('blocker があれば必ず PENDING', () => {
    const t = technicalScore(techSnapshot(series(300, (i) => 100 + i)));
    const v = verdict(t, { value: 90, factors: [], coverage: 1 }, 50, ['株価が古い'], null);
    expect(v.level).toBe('PENDING');
    expect(v.composite).toBeNull();
  });
  it('決算 7 日以内は強シグナルを抑制', () => {
    const t = { value: 95, factors: [], coverage: 1 };
    const next = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const v = verdict(t, { value: 95, factors: [], coverage: 1 }, 50, [], fund({ nextEarnings: next }));
    expect(v.level).toBe('BUY');
  });
});

describe('plans', () => {
  const candles = series(300, (i) => 100 * 1.002 ** i);
  const snap = techSnapshot(candles)!;
  const v = verdict(technicalScore(snap), { value: 70, factors: [], coverage: 1 }, 60, [], null);
  it('エントリー: 損切りはエントリーより下、目標は上、株数はリスク許容内', () => {
    const p = entryPlan(snap, v, 2, 10000, 1);
    if (p.stop !== null) {
      expect(p.stop).toBeLessThan(snap.close);
      expect(p.target!).toBeGreaterThan(snap.close * 0.95);
      const entry = p.stance === 'buy_now' ? snap.close : p.zoneHigh!;
      expect(p.shares! * (entry - p.stop)).toBeLessThanOrEqual(100.01);
    }
  });
  it('保有: 株価がストップ以下なら STOP_OUT', () => {
    const h = { id: '1', symbol: 'X', shares: 10, avgCost: snap.close * 1.5, boughtAt: '2026-01-01', stopLoss: snap.close * 1.1 };
    expect(holdPlan(h, snap, v, 2).action).toBe('STOP_OUT');
  });
  it('保有: 利確ライン到達', () => {
    const h = { id: '1', symbol: 'X', shares: 10, avgCost: snap.close * 0.8, boughtAt: '2026-01-01', takeProfit: snap.close * 0.99 };
    expect(holdPlan(h, snap, v, 2).action).toBe('TAKE_PROFIT');
  });
});

describe('integrity', () => {
  const now = Date.parse('2026-10-30T15:00:00Z'); // 11:00 ET, 取引時間中
  const candles = series(300, (i) => 100 + i * 0.1, '2026-10-29');
  const q = (p: Partial<Quote>): Quote => ({ symbol: 'X', price: 130, change: 0, changePct: 0, open: 130, high: 131, low: 129, prevClose: candles.at(-1)!.close, ts: now - 5000, source: 'finnhub', ...p });
  it('正常系は blocker なし', () => {
    expect(checkIntegrity(candles, q({}), now).blockers).toEqual([]);
  });
  it('取引時間中に 15 分以上古い株価は blocker', () => {
    expect(checkIntegrity(candles, q({ ts: now - 20 * 60_000 }), now).blockers.length).toBeGreaterThan(0);
  });
  it('ソース間で前日終値が乖離すれば blocker', () => {
    expect(checkIntegrity(candles, q({ prevClose: candles.at(-1)!.close * 1.05 }), now).blockers.join()).toMatch('乖離');
  });
  it('日足が古ければ blocker', () => {
    const old = series(300, (i) => 100 + i, '2026-10-20');
    expect(checkIntegrity(old, q({ prevClose: old.at(-1)!.close }), now).blockers.join()).toMatch('営業日古い');
  });
  it('当日暫定足のマージ', () => {
    const m = mergeLiveQuote(candles, q({ price: 140, high: 141 }), '2026-10-30');
    expect(m.at(-1)!.time).toBe('2026-10-30');
    expect(m.at(-1)!.close).toBe(140);
  });
});
