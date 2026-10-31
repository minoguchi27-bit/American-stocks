import { useMemo } from 'react';
import type { Holding } from '../lib/types';
import { analyzeSymbol } from '../lib/engine';
import type { EngineResult } from '../lib/engine';
import { useApp } from './store';
import { useNow, useSymbol } from './data';
import type { SymbolData } from './data';

export interface Analysis extends EngineResult {
  d: SymbolData;
  demo: boolean;
}

export function useAnalysis(symbol: string, holding?: Holding): Analysis {
  const d = useSymbol(symbol);
  const s = useApp((x) => x.settings);
  // 10 秒単位で鮮度判定を再評価
  const now = useNow(10_000);
  return useMemo(() => ({
    ...analyzeSymbol({ candles: d.candles, quote: d.quote, fund: d.fund, errors: d.errors, holding, settings: s, now }),
    d,
    demo: d.quote?.source === 'demo',
  }), [d, s, now, holding]);
}
