// ===== 共通型定義 =====

/** 日足ローソク (time は NY 取引日の 'YYYY-MM-DD') */
export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** リアルタイム気配 */
export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  /** 価格の約定/更新時刻 (epoch ms) */
  ts: number;
  source: DataSource;
}

/** ファンダメンタル指標 (取得できないものは null) */
export interface Fundamentals {
  symbol: string;
  name: string | null;
  sector: string | null;
  marketCap: number | null; // 百万USD
  peTTM: number | null;
  forwardPE: number | null;
  pegTTM: number | null;
  psTTM: number | null;
  pbQ: number | null;
  epsGrowthTTMYoy: number | null; // %
  revenueGrowthTTMYoy: number | null; // %
  epsGrowth5Y: number | null; // %
  roeTTM: number | null; // %
  netMarginTTM: number | null; // %
  grossMarginTTM: number | null; // %
  debtToEquity: number | null; // 倍
  currentRatio: number | null; // 倍
  fcfMarginTTM: number | null; // %
  dividendYield: number | null; // %
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
  /** アナリスト推奨 (直近月) */
  analyst: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; period: string } | null;
  /** 次回決算日 'YYYY-MM-DD' */
  nextEarnings: string | null;
  /** 直近4四半期の EPS サプライズ (%) */
  epsSurprises: number[];
  fetchedAt: number;
  source: DataSource;
}

export type DataSource = 'finnhub' | 'finnhub-ws' | 'twelvedata' | 'demo';

/** データ鮮度 */
export type Freshness = 'live' | 'fresh' | 'delayed' | 'stale' | 'closed' | 'none';

export interface Holding {
  id: string;
  symbol: string;
  shares: number;
  avgCost: number;
  boughtAt: string; // YYYY-MM-DD
  /** ユーザー定義の損切りライン (任意) */
  stopLoss?: number;
  /** ユーザー定義の利確ライン (任意) */
  takeProfit?: number;
  memo?: string;
}

export interface WatchItem {
  symbol: string;
  addedAt: string;
  memo?: string;
}

export interface Settings {
  finnhubKey: string;
  twelveDataKey: string;
  demoMode: boolean;
  /** テクニカル比重 0-100 (残りがファンダメンタル) */
  techWeight: number;
  /** 損切り ATR 倍率 */
  atrStopMult: number;
  /** 1 銘柄あたりの許容リスク (総資産比 %) */
  riskPerTradePct: number;
  /** 総資産 (USD) ポジションサイズ計算用 */
  accountSize: number;
  /** アプリ起動中のシグナル通知 */
  notifyInApp: boolean;
}

export type SignalLevel = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' | 'PENDING';

export interface Factor {
  key: string;
  label: string;
  /** -2..+2 の寄与 (正=強気) */
  score: number;
  /** 最大寄与 (重み) */
  weight: number;
  detail: string;
}
