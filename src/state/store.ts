// ===== アプリ状態 (設定・ウォッチリスト・保有) — localStorage 永続化 =====

import { useSyncExternalStore } from 'react';
import type { Holding, Settings, WatchItem } from '../lib/types';

export interface AppState {
  settings: Settings;
  watchlist: WatchItem[];
  holdings: Holding[];
}

const KEY = 'usx-state-v1';

const DEFAULT: AppState = {
  settings: {
    finnhubKey: '',
    twelveDataKey: '',
    demoMode: true,
    techWeight: 60,
    atrStopMult: 2,
    riskPerTradePct: 1,
    accountSize: 10000,
  },
  watchlist: [
    { symbol: 'NVDA', addedAt: '2026-01-01' },
    { symbol: 'MSFT', addedAt: '2026-01-01' },
    { symbol: 'TSLA', addedAt: '2026-01-01' },
  ],
  holdings: [
    { id: 'h1', symbol: 'AAPL', shares: 20, avgCost: 190, boughtAt: '2026-03-02' },
    { id: 'h2', symbol: 'INTC', shares: 50, avgCost: 38, boughtAt: '2026-05-11' },
  ],
};

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const s = JSON.parse(raw) as Partial<AppState>;
    return { ...DEFAULT, ...s, settings: { ...DEFAULT.settings, ...s.settings } };
  } catch {
    return DEFAULT;
  }
}

let state = load();
const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function setState(fn: (s: AppState) => AppState) {
  state = fn(state);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* noop */ }
  listeners.forEach((l) => l());
}

export function useApp<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => sel(state));
}

export const normalizeSymbol = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '');

export const actions = {
  updateSettings(p: Partial<Settings>) {
    setState((s) => ({ ...s, settings: { ...s.settings, ...p } }));
  },
  addWatch(symbol: string) {
    const sym = normalizeSymbol(symbol);
    if (!sym) return;
    setState((s) => s.watchlist.some((w) => w.symbol === sym) ? s
      : { ...s, watchlist: [...s.watchlist, { symbol: sym, addedAt: new Date().toISOString().slice(0, 10) }] });
  },
  removeWatch(symbol: string) {
    setState((s) => ({ ...s, watchlist: s.watchlist.filter((w) => w.symbol !== symbol) }));
  },
  upsertHolding(h: Holding) {
    setState((s) => ({
      ...s,
      holdings: s.holdings.some((x) => x.id === h.id) ? s.holdings.map((x) => (x.id === h.id ? h : x)) : [...s.holdings, h],
    }));
  },
  removeHolding(id: string) {
    setState((s) => ({ ...s, holdings: s.holdings.filter((h) => h.id !== id) }));
  },
  exportJson() {
    return JSON.stringify({ watchlist: state.watchlist, holdings: state.holdings }, null, 2);
  },
  importJson(json: string) {
    const d = JSON.parse(json) as Partial<AppState>;
    if (!Array.isArray(d.watchlist) || !Array.isArray(d.holdings)) throw new Error('形式が不正です');
    setState((s) => ({ ...s, watchlist: d.watchlist!, holdings: d.holdings! }));
  },
};
