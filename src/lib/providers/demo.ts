// ===== デモデータ (API キー未設定時の UI 確認用。実データではない) =====

import type { Candle, Fundamentals, Quote } from '../types';
import { isTradingDay, lastTradingDate, nyParts } from '../market';

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

const PROFILES: Record<string, { name: string; base: number; drift: number; vol: number; sector: string }> = {
  AAPL: { name: 'Apple Inc (DEMO)', base: 180, drift: 0.0006, vol: 0.016, sector: 'Technology' },
  MSFT: { name: 'Microsoft Corp (DEMO)', base: 380, drift: 0.0007, vol: 0.014, sector: 'Technology' },
  NVDA: { name: 'NVIDIA Corp (DEMO)', base: 90, drift: 0.0018, vol: 0.03, sector: 'Semiconductors' },
  TSLA: { name: 'Tesla Inc (DEMO)', base: 260, drift: -0.0006, vol: 0.035, sector: 'Automobiles' },
  AMZN: { name: 'Amazon.com Inc (DEMO)', base: 170, drift: 0.0005, vol: 0.019, sector: 'Retail' },
  INTC: { name: 'Intel Corp (DEMO)', base: 40, drift: -0.0012, vol: 0.025, sector: 'Semiconductors' },
};

const profile = (s: string) => PROFILES[s] ?? { name: `${s} (DEMO)`, base: 50 + (hash(s) % 300), drift: ((hash(s) % 21) - 10) / 10000, vol: 0.02, sector: 'N/A' };

export function demoCandles(symbol: string): Candle[] {
  const p = profile(symbol);
  const r = rng(hash(symbol));
  const end = lastTradingDate();
  const dates: string[] = [];
  let d = new Date(end + 'T12:00:00Z');
  while (dates.length < 400) {
    const s = d.toISOString().slice(0, 10);
    if (isTradingDay(s)) dates.unshift(s);
    d = new Date(d.getTime() - 86400000);
  }
  let price = p.base;
  return dates.map((time) => {
    const z = (r() + r() + r() - 1.5) * 2;
    const open = price;
    const close = Math.max(1, open * (1 + p.drift + p.vol * z));
    const high = Math.max(open, close) * (1 + r() * p.vol * 0.6);
    const low = Math.min(open, close) * (1 - r() * p.vol * 0.6);
    price = close;
    return { time, open, high, low, close, volume: Math.round(2e7 * (0.6 + r() * 0.9) * (1 + Math.abs(z) * 0.4)) };
  });
}

export function demoQuote(symbol: string, candles: Candle[]): Quote {
  // 当日足がまだ無い (寄り前) 場合は最終足が前日終値になる
  const today = nyParts().date;
  const hasToday = candles[candles.length - 1].time >= today;
  const lastC = candles[candles.length - 1];
  const prevC = hasToday ? candles[candles.length - 2] : lastC;
  const wiggle = 1 + Math.sin(Date.now() / 7000 + hash(symbol)) * 0.002;
  const price = +(lastC.close * wiggle).toFixed(2);
  return {
    symbol, price, change: price - prevC.close, changePct: ((price - prevC.close) / prevC.close) * 100,
    open: lastC.open, high: Math.max(lastC.high, price), low: Math.min(lastC.low, price), prevClose: prevC.close,
    ts: Date.now(), source: 'demo',
  };
}

export function demoFundamentals(symbol: string): Fundamentals {
  const p = profile(symbol);
  const r = rng(hash(symbol) + 99);
  const good = p.drift > 0;
  return {
    symbol, name: p.name, sector: p.sector,
    marketCap: Math.round(50000 + r() * 2_000_000),
    peTTM: good ? 20 + r() * 25 : 45 + r() * 40,
    forwardPE: good ? 18 + r() * 15 : 35 + r() * 30,
    pegTTM: good ? 0.9 + r() * 1.2 : 2.5 + r() * 2,
    psTTM: 3 + r() * 10, pbQ: 4 + r() * 20,
    epsGrowthTTMYoy: good ? 10 + r() * 30 : -20 + r() * 15,
    revenueGrowthTTMYoy: good ? 6 + r() * 25 : -8 + r() * 10,
    epsGrowth5Y: 5 + r() * 20,
    roeTTM: good ? 18 + r() * 30 : 2 + r() * 8,
    netMarginTTM: good ? 15 + r() * 20 : r() * 6,
    grossMarginTTM: 40 + r() * 30,
    debtToEquity: good ? 0.3 + r() * 0.8 : 1.2 + r() * 1.5,
    currentRatio: 0.9 + r() * 1.5,
    fcfMarginTTM: null, dividendYield: r() * 1.5, beta: 0.8 + r() * 1,
    week52High: null, week52Low: null,
    analyst: { strongBuy: Math.round(r() * 15), buy: Math.round(r() * 20), hold: Math.round(r() * 12), sell: Math.round(r() * 3), strongSell: Math.round(r() * 2), period: 'DEMO' },
    nextEarnings: new Date(Date.now() + (5 + Math.floor(r() * 80)) * 86400000).toISOString().slice(0, 10),
    epsSurprises: [r() * 10 - 3, r() * 10 - 3, r() * 10 - 3, r() * 10 - 3],
    fetchedAt: Date.now(), source: 'demo',
  };
}
