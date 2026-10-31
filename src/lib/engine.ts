// ===== 銘柄単位の判定エンジン (アプリと通知スクリプトで共用) =====

import type { Candle, Fundamentals, Holding, Quote, Settings } from './types';
import { entryPlan, fundamentalScore, holdPlan, mergeLiveQuote, techSnapshot, technicalScore, verdict } from './analysis';
import type { EntryPlan, HoldPlan, TechSnapshot, Verdict } from './analysis';
import { checkIntegrity } from './integrity';
import type { IntegrityReport } from './integrity';
import { lastTradingDate, marketSession } from './market';

export type EngineSettings = Pick<Settings, 'techWeight' | 'atrStopMult' | 'accountSize' | 'riskPerTradePct'>;

export interface EngineInput {
  candles: Candle[] | null;
  quote: Quote | null;
  fund: Fundamentals | null;
  errors?: string[];
  holding?: Holding;
  settings: EngineSettings;
  now?: number;
}

export interface EngineResult {
  candles: Candle[];
  snap: TechSnapshot | null;
  integrity: IntegrityReport;
  verdict: Verdict;
  plan: EntryPlan | HoldPlan | null;
}

export function analyzeSymbol({ candles: raw0, quote, fund, errors = [], holding, settings: s, now = Date.now() }: EngineInput): EngineResult {
  const raw = raw0 ?? [];
  const integrity = checkIntegrity(raw, quote, now);
  // 取引時間中のみ気配を当日足へ反映 (時間外は確定日足を使用)
  const candles = marketSession(now) === 'regular' ? mergeLiveQuote(raw, quote, lastTradingDate(now)) : raw;
  const snap = techSnapshot(candles);
  const tech = technicalScore(snap);
  const fs = fundamentalScore(fund);
  const blockers = [...integrity.blockers, ...errors.filter((e) => e.startsWith('日足') || e.startsWith('株価'))];
  const v = verdict(tech, fs, s.techWeight, Array.from(new Set(blockers)), fund);
  v.warnings.push(...integrity.warnings);
  let plan: EngineResult['plan'] = null;
  if (snap) {
    plan = holding ? holdPlan(holding, snap, v, s.atrStopMult) : entryPlan(snap, v, s.atrStopMult, s.accountSize, s.riskPerTradePct);
  }
  return { candles, snap, integrity, verdict: v, plan };
}
