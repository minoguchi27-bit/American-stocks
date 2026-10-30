import { useMemo } from 'react';
import type { Holding } from '../lib/types';
import { entryPlan, fundamentalScore, holdPlan, mergeLiveQuote, techSnapshot, technicalScore, verdict } from '../lib/analysis';
import type { EntryPlan, HoldPlan, TechSnapshot, Verdict } from '../lib/analysis';
import { checkIntegrity } from '../lib/integrity';
import type { IntegrityReport } from '../lib/integrity';
import { lastTradingDate, marketSession } from '../lib/market';
import { useApp } from './store';
import { useNow, useSymbol } from './data';
import type { SymbolData } from './data';

export interface Analysis {
  d: SymbolData;
  candles: SymbolData['candles'];
  snap: TechSnapshot | null;
  integrity: IntegrityReport;
  verdict: Verdict;
  plan: EntryPlan | HoldPlan | null;
  demo: boolean;
}

export function useAnalysis(symbol: string, holding?: Holding): Analysis {
  const d = useSymbol(symbol);
  const s = useApp((x) => x.settings);
  // 10 秒単位で鮮度判定を再評価
  const now = useNow(10_000);
  return useMemo(() => {
    const raw = d.candles ?? [];
    const integrity = checkIntegrity(raw, d.quote, now);
    // 取引時間中のみ気配を当日足へ反映 (時間外は確定日足を使用)
    const tradingDate = lastTradingDate(now);
    const candles = marketSession(now) === 'regular' ? mergeLiveQuote(raw, d.quote, tradingDate) : raw;
    const snap = techSnapshot(candles);
    const tech = technicalScore(snap);
    const fund = fundamentalScore(d.fund);
    const blockers = [...integrity.blockers, ...d.errors.filter((e) => e.startsWith('日足') || e.startsWith('株価'))];
    const v = verdict(tech, fund, s.techWeight, Array.from(new Set(blockers)), d.fund);
    v.warnings.push(...integrity.warnings);
    let plan: Analysis['plan'] = null;
    if (snap) {
      plan = holding ? holdPlan(holding, snap, v, s.atrStopMult) : entryPlan(snap, v, s.atrStopMult, s.accountSize, s.riskPerTradePct);
    }
    return { d, candles, snap, integrity, verdict: v, plan, demo: d.quote?.source === 'demo' };
  }, [d, s, now, holding]);
}
