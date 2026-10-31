import { describe, expect, it } from 'vitest';
import { alertFor, nextMemo, shouldNotify } from './alerts';
import type { EngineResult } from './engine';
import { buildNotifyConfig, parseNotifyConfig } from './notifyConfig';

const verdict = (level: EngineResult['verdict']['level']) => ({
  composite: level === 'PENDING' ? null : 65, level, warnings: [],
  tech: { value: 60, factors: [], coverage: 1 }, fund: { value: 60, factors: [], coverage: 1 },
});
const res = (plan: EngineResult['plan'], level: EngineResult['verdict']['level'] = 'BUY'): EngineResult => ({
  candles: [], snap: null, integrity: { blockers: [], warnings: [], checks: [] }, verdict: verdict(level), plan,
});
const hold = (action: 'STOP_OUT' | 'HOLD' | 'TAKE_PROFIT') => ({
  kind: 'hold' as const, action, headline: 'x', pnl: 10, pnlPct: 5, stop: 90, trailingStop: 95, target: null, notes: [],
});
const entry = (stance: 'buy_now' | 'wait_pullback') => ({
  kind: 'entry' as const, stance, headline: 'x', zoneLow: 1, zoneHigh: 2, stop: 90, target: 120, rr: 2, shares: 10, notes: [],
});

describe('alertFor', () => {
  it('損切りは緊急通知', () => {
    const a = alertFor('AAPL', res(hold('STOP_OUT')), 94);
    expect(a.notify).toBe(true);
    expect(a.priority).toBe('urgent');
  });
  it('判定保留中でも損切りは通知、その他は通知しない', () => {
    expect(alertFor('A', res(hold('STOP_OUT'), 'PENDING'), 94).notify).toBe(true);
    expect(alertFor('A', res(entry('buy_now'), 'PENDING'), 94).notify).toBe(false);
  });
  it('保有継続・押し目待ちは通知しない', () => {
    expect(alertFor('A', res(hold('HOLD')), 100).notify).toBe(false);
    expect(alertFor('A', res(entry('wait_pullback')), 100).notify).toBe(false);
  });
  it('買いシグナル', () => {
    const a = alertFor('NVDA', res(entry('buy_now')), 100);
    expect(a.notify).toBe(true);
    expect(a.title).toContain('NVDA');
  });
});

describe('dedup', () => {
  const stop = alertFor('A', res(hold('STOP_OUT')), 94);
  const tp = alertFor('A', res(hold('TAKE_PROFIT')), 130);
  const pending = alertFor('A', res(entry('buy_now'), 'PENDING'), 94);
  it('初回と状態変化で通知、同一状態は通知しない', () => {
    expect(shouldNotify(tp, undefined, '2026-11-02')).toBe(true);
    const m = nextMemo(tp, undefined, '2026-11-02', true);
    expect(shouldNotify(tp, m, '2026-11-02')).toBe(false);
    expect(shouldNotify(tp, m, '2026-11-03')).toBe(false); // 非緊急は翌日も再通知しない
  });
  it('緊急は 1 日 1 回再通知', () => {
    const m = nextMemo(stop, undefined, '2026-11-02', true);
    expect(shouldNotify(stop, m, '2026-11-02')).toBe(false);
    expect(shouldNotify(stop, m, '2026-11-03')).toBe(true);
  });
  it('一時的な判定保留では状態を上書きしない', () => {
    const m = nextMemo(tp, undefined, '2026-11-02', true);
    const m2 = nextMemo(pending, m, '2026-11-02', false);
    expect(m2).toEqual(m);
    expect(shouldNotify(tp, m2, '2026-11-02')).toBe(false);
  });
});

describe('notifyConfig', () => {
  const s = { finnhubKey: 'SECRET', twelveDataKey: 'SECRET2', demoMode: false, techWeight: 60, atrStopMult: 2, riskPerTradePct: 1, accountSize: 10000, notifyInApp: true };
  it('API キーを含めない & 往復できる', () => {
    const json = buildNotifyConfig([{ id: '1', symbol: 'AAPL', shares: 1, avgCost: 100, boughtAt: '2026-01-01' }], [{ symbol: 'NVDA', addedAt: '2026-01-01' }], s);
    expect(json).not.toContain('SECRET');
    expect(parseNotifyConfig(json).holdings[0].symbol).toBe('AAPL');
  });
  it('不正 JSON はエラー', () => {
    expect(() => parseNotifyConfig('{')).toThrow();
    expect(() => parseNotifyConfig('{"holdings":[{"symbol":"A"}],"watchlist":[],"settings":{}}')).toThrow();
  });
});
