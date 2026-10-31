// ===== サーバー通知用の設定 JSON (アプリでエクスポート → GitHub Secret NOTIFY_CONFIG) =====
// API キーは含めない (キーは別の Secret で管理)

import type { Holding, Settings, WatchItem } from './types';
import type { EngineSettings } from './engine';

export interface NotifyConfig {
  v: 1;
  holdings: Holding[];
  watchlist: WatchItem[];
  settings: EngineSettings;
}

export function buildNotifyConfig(holdings: Holding[], watchlist: WatchItem[], s: Settings): string {
  const cfg: NotifyConfig = {
    v: 1,
    holdings,
    watchlist,
    settings: { techWeight: s.techWeight, atrStopMult: s.atrStopMult, accountSize: s.accountSize, riskPerTradePct: s.riskPerTradePct },
  };
  return JSON.stringify(cfg);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseNotifyConfig(json: string): NotifyConfig {
  let d: Partial<NotifyConfig>;
  try {
    d = JSON.parse(json) as Partial<NotifyConfig>;
  } catch {
    throw new Error('NOTIFY_CONFIG が JSON として読めません');
  }
  if (!Array.isArray(d.holdings) || !Array.isArray(d.watchlist) || !d.settings) throw new Error('NOTIFY_CONFIG の形式が不正です');
  for (const h of d.holdings) {
    if (!h.symbol || !isNum(h.shares) || !isNum(h.avgCost) || !h.id) throw new Error(`保有データが不正です: ${JSON.stringify(h)}`);
  }
  const s = d.settings;
  if (![s.techWeight, s.atrStopMult, s.accountSize, s.riskPerTradePct].every(isNum)) throw new Error('判定パラメータが不正です');
  return { v: 1, holdings: d.holdings, watchlist: d.watchlist, settings: s };
}
