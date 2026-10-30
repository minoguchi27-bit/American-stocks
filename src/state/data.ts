// ===== マーケットデータハブ =====
// 銘柄ごとに 日足 / ファンダメンタル / 気配 を管理し、
// WebSocket (Finnhub) + REST ポーリングでリアルタイム更新する。

import { useEffect, useSyncExternalStore } from 'react';
import type { Candle, Fundamentals, Quote } from '../lib/types';
import { FinnhubStream, fhFundamentals, fhQuote } from '../lib/providers/finnhub';
import { tdDaily } from '../lib/providers/twelvedata';
import { demoCandles, demoFundamentals, demoQuote } from '../lib/providers/demo';
import { marketSession } from '../lib/market';
import { getState } from './store';

export interface SymbolData {
  candles: Candle[] | null;
  candlesAt: number | null;
  fund: Fundamentals | null;
  quote: Quote | null;
  errors: string[];
  loading: boolean;
}

const EMPTY: SymbolData = { candles: null, candlesAt: null, fund: null, quote: null, errors: [], loading: false };

const data = new Map<string, SymbolData>();
const listeners = new Set<() => void>();
let version = 0;
let wsStatus: FinnhubStream['status'] = 'closed';
let stream: FinnhubStream | null = null;
let streamKey = '';

function emit() {
  version++;
  listeners.forEach((l) => l());
}

function patch(symbol: string, p: Partial<SymbolData>) {
  data.set(symbol, { ...(data.get(symbol) ?? EMPTY), ...p });
  emit();
}

const isDemo = () => {
  const s = getState().settings;
  return s.demoMode || !s.finnhubKey || !s.twelveDataKey;
};

const inflight = new Map<string, Promise<void>>();

/** 日足 + ファンダメンタル + 気配を取得 */
export function loadSymbol(symbol: string, force = false): Promise<void> {
  const k = symbol + (force ? ':f' : '');
  if (inflight.has(k)) return inflight.get(k)!;
  const p = (async () => {
    const cur = data.get(symbol);
    if (!force && cur?.candles && cur.fund && cur.quote) return;
    patch(symbol, { loading: true, errors: [] });
    if (isDemo()) {
      const candles = demoCandles(symbol);
      patch(symbol, { candles, candlesAt: Date.now(), fund: demoFundamentals(symbol), quote: demoQuote(symbol, candles), loading: false });
      return;
    }
    const { finnhubKey, twelveDataKey } = getState().settings;
    const errors: string[] = [];
    const [c, f, q] = await Promise.allSettled([
      tdDaily(symbol, twelveDataKey, force),
      fhFundamentals(symbol, finnhubKey, force),
      fhQuote(symbol, finnhubKey),
    ]);
    const p: Partial<SymbolData> = { loading: false };
    if (c.status === 'fulfilled') { p.candles = c.value.candles; p.candlesAt = c.value.fetchedAt; } else errors.push(`日足: ${(c.reason as Error).message}`);
    if (f.status === 'fulfilled') p.fund = f.value; else errors.push(`財務: ${(f.reason as Error).message}`);
    if (q.status === 'fulfilled') p.quote = mergeQuote(data.get(symbol)?.quote ?? null, q.value); else errors.push(`株価: ${(q.reason as Error).message}`);
    p.errors = errors;
    patch(symbol, p);
  })().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/** WS 約定の方が新しければそちらを優先 */
function mergeQuote(old: Quote | null, next: Quote): Quote {
  if (old && old.ts > next.ts && old.source === 'finnhub-ws') {
    return { ...next, price: old.price, ts: old.ts, source: old.source,
      change: old.price - next.prevClose, changePct: ((old.price - next.prevClose) / next.prevClose) * 100,
      high: Math.max(next.high, old.price), low: Math.min(next.low || old.price, old.price) };
  }
  return next;
}

async function refreshQuote(symbol: string) {
  try {
    if (isDemo()) {
      const c = data.get(symbol)?.candles;
      if (c) patch(symbol, { quote: demoQuote(symbol, c) });
      return;
    }
    const q = await fhQuote(symbol, getState().settings.finnhubKey);
    patch(symbol, { quote: mergeQuote(data.get(symbol)?.quote ?? null, q) });
  } catch { /* 次回ポーリングで再試行。鮮度ゲートが STALE を検出する */ }
}

function onTrade(symbol: string, price: number, ts: number) {
  const cur = data.get(symbol);
  if (!cur?.quote || ts < cur.quote.ts) return;
  // 異常約定フィルタ: 直前価格から 10% 超の乖離は無視 (誤配信・特殊約定対策)
  if (Math.abs(price - cur.quote.price) / cur.quote.price > 0.1) return;
  const q = cur.quote;
  patch(symbol, {
    quote: { ...q, price, ts, source: 'finnhub-ws', change: price - q.prevClose, changePct: ((price - q.prevClose) / q.prevClose) * 100,
      high: Math.max(q.high, price), low: Math.min(q.low || price, price) },
  });
}

function syncStream(symbols: string[]) {
  const { finnhubKey } = getState().settings;
  if (isDemo()) {
    stream?.close(); stream = null; streamKey = '';
    if (wsStatus !== 'closed') { wsStatus = 'closed'; emit(); }
    return;
  }
  if (!stream || streamKey !== finnhubKey) {
    stream?.close();
    streamKey = finnhubKey;
    stream = new FinnhubStream(finnhubKey, onTrade, (s) => { wsStatus = s; emit(); });
    stream.connect();
  }
  stream.setSymbols(symbols);
}

/** 追跡対象の銘柄群を購読 (ロード + WS + ポーリング) */
export function useTracking(symbols: string[], focus?: string) {
  const key = symbols.join(',') + '|' + (focus ?? '');
  const demo = useSyncExternalStore(subscribe, isDemo);
  useEffect(() => {
    const all = Array.from(new Set([...symbols, ...(focus ? [focus] : [])]));
    all.forEach((s) => loadSymbol(s));
    syncStream(all);
    // ポーリング: 全銘柄は 60 秒, フォーカス銘柄は 15 秒 (WS の欠落補完・検証用)
    const slow = setInterval(() => {
      const regular = marketSession() === 'regular';
      if (regular || Math.random() < 0.2) all.forEach((s) => refreshQuote(s));
    }, demo ? 5000 : 60_000);
    const fast = focus ? setInterval(() => refreshQuote(focus), demo ? 2000 : 15_000) : null;
    return () => { clearInterval(slow); if (fast) clearInterval(fast); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, demo]);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useSymbol(symbol: string): SymbolData {
  useSyncExternalStore(subscribe, () => version);
  return data.get(symbol) ?? EMPTY;
}

export function useWsStatus() {
  return useSyncExternalStore(subscribe, () => wsStatus);
}

/** 1 秒ごとに再描画 (鮮度表示の更新用) */
export function useNow(intervalMs = 1000) {
  return useSyncExternalStore(
    (l) => { const t = setInterval(l, intervalMs); return () => clearInterval(t); },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
  );
}

/** 設定変更 (キー/デモ切替) 時に全データを破棄して再取得 */
export function resetData() {
  data.clear();
  stream?.close(); stream = null; streamKey = '';
  emit();
}

/** 複数銘柄を参照する集計用 (データ更新で再描画) */
export function useSymbols(symbols: string[]): SymbolData[] {
  useSyncExternalStore(subscribe, () => version);
  return symbols.map((s) => data.get(s) ?? EMPTY);
}
