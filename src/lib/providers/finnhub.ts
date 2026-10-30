// ===== Finnhub: リアルタイム気配 / WebSocket 約定 / ファンダメンタル =====
// 無料プラン: REST 60 回/分, WebSocket 米国株リアルタイム約定
// https://finnhub.io/docs/api

import type { Fundamentals, Quote } from '../types';
import { ApiError, RateLimiter, cacheGet, cacheSet, getJson } from './http';

const BASE = 'https://finnhub.io/api/v1';
const limiter = new RateLimiter(55, 60_000);

const call = <T>(path: string, key: string) =>
  limiter.schedule(() => getJson<T>(`${BASE}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(key)}`, 'Finnhub'));

interface FhQuote { c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number }

export async function fhQuote(symbol: string, key: string): Promise<Quote> {
  const q = await call<FhQuote>(`/quote?symbol=${encodeURIComponent(symbol)}`, key);
  if (!q || !q.c || !q.t) throw new ApiError(`${symbol}: 株価データがありません (ティッカーを確認してください)`, 'Finnhub');
  return {
    symbol, price: q.c, change: q.d, changePct: q.dp, open: q.o, high: q.h, low: q.l, prevClose: q.pc,
    ts: q.t * 1000, source: 'finnhub',
  };
}

export async function fhSearch(query: string, key: string) {
  const r = await call<{ result: { symbol: string; description: string; type: string }[] }>(`/search?q=${encodeURIComponent(query)}&exchange=US`, key);
  return (r.result ?? []).filter((x) => !x.symbol.includes('.') && (x.type === 'Common Stock' || x.type === 'ETP' || x.type === 'ADR')).slice(0, 12);
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pick = (m: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) {
    const v = num(m[k]);
    if (v !== null) return v;
  }
  return null;
};

const FUND_TTL = 6 * 3600_000;

export async function fhFundamentals(symbol: string, key: string, force = false): Promise<Fundamentals> {
  const ck = `fh-fund:${symbol}`;
  if (!force) {
    const c = cacheGet<Fundamentals>(ck, FUND_TTL);
    if (c) return c.value;
  }
  const today = new Date();
  const to = new Date(today.getTime() + 120 * 86400000).toISOString().slice(0, 10);
  const from = today.toISOString().slice(0, 10);
  const [metric, profile, rec, earn, cal] = await Promise.all([
    call<{ metric: Record<string, unknown> }>(`/stock/metric?symbol=${symbol}&metric=all`, key),
    call<Record<string, unknown>>(`/stock/profile2?symbol=${symbol}`, key).catch(() => ({} as Record<string, unknown>)),
    call<{ strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; period: string }[]>(`/stock/recommendation?symbol=${symbol}`, key).catch(() => []),
    call<{ surprisePercent: number | null; period: string }[]>(`/stock/earnings?symbol=${symbol}&limit=4`, key).catch(() => []),
    call<{ earningsCalendar: { date: string }[] }>(`/calendar/earnings?symbol=${symbol}&from=${from}&to=${to}`, key).catch(() => ({ earningsCalendar: [] })),
  ]);
  const m = metric?.metric ?? {};
  const debtEq = pick(m, 'totalDebt/totalEquityQuarterly', 'totalDebt/totalEquityAnnual');
  const f: Fundamentals = {
    symbol,
    name: (profile.name as string) || null,
    sector: (profile.finnhubIndustry as string) || null,
    marketCap: pick(m, 'marketCapitalization') ?? num(profile.marketCapitalization),
    peTTM: pick(m, 'peTTM', 'peExclExtraTTM', 'peBasicExclExtraTTM'),
    forwardPE: pick(m, 'forwardPE'),
    pegTTM: pick(m, 'pegTTM', 'pegRatio'),
    psTTM: pick(m, 'psTTM', 'psAnnual'),
    pbQ: pick(m, 'pbQuarterly', 'pbAnnual'),
    epsGrowthTTMYoy: pick(m, 'epsGrowthTTMYoy', 'epsGrowthQuarterlyYoy'),
    revenueGrowthTTMYoy: pick(m, 'revenueGrowthTTMYoy', 'revenueGrowthQuarterlyYoy'),
    epsGrowth5Y: pick(m, 'epsGrowth5Y'),
    roeTTM: pick(m, 'roeTTM', 'roeRfy'),
    netMarginTTM: pick(m, 'netProfitMarginTTM', 'netProfitMarginAnnual'),
    grossMarginTTM: pick(m, 'grossMarginTTM', 'grossMarginAnnual'),
    debtToEquity: debtEq,
    currentRatio: pick(m, 'currentRatioQuarterly', 'currentRatioAnnual'),
    fcfMarginTTM: null,
    dividendYield: pick(m, 'currentDividendYieldTTM', 'dividendYieldIndicatedAnnual'),
    beta: pick(m, 'beta'),
    week52High: pick(m, '52WeekHigh'),
    week52Low: pick(m, '52WeekLow'),
    analyst: Array.isArray(rec) && rec.length ? { ...rec[0] } : null,
    nextEarnings: cal?.earningsCalendar?.map((e) => e.date).filter((d) => d >= from).sort()[0] ?? null,
    epsSurprises: (Array.isArray(earn) ? earn : []).map((e) => e.surprisePercent).filter((x): x is number => typeof x === 'number').slice(0, 4),
    fetchedAt: Date.now(),
    source: 'finnhub',
  };
  cacheSet(ck, f);
  return f;
}

// ===== WebSocket (リアルタイム約定) =====

type TradeListener = (symbol: string, price: number, ts: number) => void;

export class FinnhubStream {
  private ws: WebSocket | null = null;
  private subs = new Set<string>();
  private retry = 0;
  private closedByUser = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  status: 'connecting' | 'open' | 'closed' | 'error' = 'closed';

  constructor(private key: string, private onTrade: TradeListener, private onStatus: (s: FinnhubStream['status']) => void) {}

  connect() {
    this.closedByUser = false;
    this.setStatus('connecting');
    const ws = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(this.key)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
      this.subs.forEach((s) => ws.send(JSON.stringify({ type: 'subscribe', symbol: s })));
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string; data?: { s: string; p: number; t: number }[] };
        if (msg.type !== 'trade' || !msg.data) return;
        // 同一銘柄はバッチ内で最新時刻の約定のみ採用
        const latest = new Map<string, { p: number; t: number }>();
        for (const d of msg.data) {
          const cur = latest.get(d.s);
          if (!cur || d.t >= cur.t) latest.set(d.s, { p: d.p, t: d.t });
        }
        latest.forEach((v, s) => this.onTrade(s, v.p, v.t));
      } catch { /* ignore malformed */ }
    };
    ws.onerror = () => this.setStatus('error');
    ws.onclose = () => {
      this.setStatus('closed');
      if (this.closedByUser) return;
      // 指数バックオフで再接続 (最大 60 秒)
      const delay = Math.min(60_000, 1000 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  private setStatus(s: FinnhubStream['status']) {
    this.status = s;
    this.onStatus(s);
  }

  setSymbols(symbols: string[]) {
    const next = new Set(symbols);
    const open = this.ws?.readyState === WebSocket.OPEN;
    this.subs.forEach((s) => { if (!next.has(s) && open) this.ws!.send(JSON.stringify({ type: 'unsubscribe', symbol: s })); });
    next.forEach((s) => { if (!this.subs.has(s) && open) this.ws!.send(JSON.stringify({ type: 'subscribe', symbol: s })); });
    this.subs = next;
  }

  close() {
    this.closedByUser = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
  }
}
