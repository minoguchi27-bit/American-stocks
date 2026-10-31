// ===== テクニカル / ファンダメンタル スコアリングと売買示唆 =====
// すべてルールベース・決定的。各要因の寄与を Factor として返し、根拠を UI に開示する。

import type { Candle, Factor, Fundamentals, Holding, Quote, SignalLevel } from './types';
import { adx, atr, bollinger, highest, last, lowest, macd, prev, rsi, sma } from './indicators';

export const MIN_BARS = 200;

export interface TechSnapshot {
  close: number;
  sma20: number; sma50: number; sma200: number;
  sma200Slope: number; // 20 営業日前比 %
  rsi14: number;
  macd: number; macdSignal: number; macdHist: number; macdHistPrev: number;
  bbUpper: number; bbLower: number; pctB: number;
  atr14: number; atrPct: number;
  adx14: number;
  volRatio: number; // 当日出来高 / 20 日平均
  high52: number; low52: number;
  high22: number; low20: number;
  dayChangePct: number;
}

export interface Score {
  value: number | null; // 0-100, null = 判定保留
  factors: Factor[];
  coverage: number; // 使用できた要因の重み比率 0-1
}

const clamp = (v: number, lo = -2, hi = 2) => Math.max(lo, Math.min(hi, v));
const fin = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

function toScore(factors: Factor[], totalWeight: number): Score {
  const used = factors.reduce((s, f) => s + f.weight, 0);
  if (used === 0) return { value: null, factors, coverage: 0 };
  const raw = factors.reduce((s, f) => s + f.score * f.weight, 0) / (2 * used);
  return { value: Math.round(50 + 50 * raw), factors, coverage: used / totalWeight };
}

/** 直近のリアルタイム価格を当日足に反映 (日足確定前の暫定足) */
export function mergeLiveQuote(candles: Candle[], quote: Quote | null, tradingDate: string): Candle[] {
  if (!quote || candles.length === 0) return candles;
  const lastC = candles[candles.length - 1];
  if (lastC.time === tradingDate) {
    const merged = {
      ...lastC,
      close: quote.price,
      high: Math.max(lastC.high, quote.price, quote.high || 0),
      low: Math.min(lastC.low, quote.price, quote.low || Infinity),
    };
    return [...candles.slice(0, -1), merged];
  }
  if (lastC.time < tradingDate && quote.open > 0) {
    return [...candles, { time: tradingDate, open: quote.open, high: quote.high, low: quote.low, close: quote.price, volume: 0 }];
  }
  return candles;
}

export function techSnapshot(candles: Candle[]): TechSnapshot | null {
  if (candles.length < MIN_BARS) return null;
  const c = candles.map((x) => x.close);
  const h = candles.map((x) => x.high);
  const l = candles.map((x) => x.low);
  const v = candles.map((x) => x.volume);
  const s200 = sma(c, 200);
  const m = macd(c);
  const bb = bollinger(c);
  const a = atr(h, l, c);
  // 当日出来高 0 (暫定足) の場合は前日を参照
  const volIdx = v[v.length - 1] > 0 ? v.length - 1 : v.length - 2;
  const avgVol = sma(v, 20)[volIdx - 1];
  const close = last(c);
  const bbU = last(bb.upper), bbL = last(bb.lower);
  return {
    close,
    sma20: last(sma(c, 20)),
    sma50: last(sma(c, 50)),
    sma200: last(s200),
    sma200Slope: ((last(s200) - prev(s200, 20)) / prev(s200, 20)) * 100,
    rsi14: last(rsi(c)),
    macd: last(m.line), macdSignal: last(m.signal), macdHist: last(m.hist), macdHistPrev: prev(m.hist),
    bbUpper: bbU, bbLower: bbL, pctB: bbU === bbL ? 0.5 : (close - bbL) / (bbU - bbL),
    atr14: last(a), atrPct: (last(a) / close) * 100,
    adx14: last(adx(h, l, c)),
    volRatio: avgVol > 0 ? v[volIdx] / avgVol : 1,
    high52: highest(h, 252), low52: lowest(l, 252),
    high22: highest(h, 22), low20: lowest(l, 20, l.length - 2),
    dayChangePct: ((close - prev(c)) / prev(c)) * 100,
  };
}

const f1 = (n: number, d = 1) => n.toFixed(d);

export function technicalScore(t: TechSnapshot | null): Score {
  const TOTAL = 12;
  if (!t) return { value: null, factors: [], coverage: 0 };
  const F: Factor[] = [];
  const above200 = t.close > t.sma200;

  // 1. 長期トレンド
  {
    let s = above200 ? 1 : -1;
    if (t.sma200Slope > 1) s += 1;
    else if (t.sma200Slope < -1) s -= 1;
    F.push({ key: 'trend', label: '長期トレンド', weight: 3, score: clamp(s),
      detail: `株価は200日線の${above200 ? '上' : '下'} / 200日線の傾き ${f1(t.sma200Slope)}%(20日)` });
  }
  // 2. 中期トレンド (GC/DC)
  {
    const gc = t.sma50 > t.sma200;
    let s = gc ? 1 : -1;
    s += t.close > t.sma50 ? 1 : -1;
    F.push({ key: 'mid', label: '中期トレンド', weight: 2, score: clamp(s),
      detail: `50日線${gc ? '>' : '<'}200日線(${gc ? 'ゴールデン' : 'デッド'}クロス圏) / 株価は50日線の${t.close > t.sma50 ? '上' : '下'}` });
  }
  // 3. MACD
  {
    let s = t.macdHist > 0 ? 1 : -1;
    if (t.macdHist > 0 && t.macdHistPrev <= 0) s = 2; // 直近ゴールデンクロス
    else if (t.macdHist < 0 && t.macdHistPrev >= 0) s = -2;
    else if (t.macdHist > t.macdHistPrev && t.macdHist < 0) s = 0; // 下落モメンタム減速
    else if (t.macdHist < t.macdHistPrev && t.macdHist > 0) s = 0;
    F.push({ key: 'macd', label: 'MACD', weight: 2, score: s,
      detail: `ヒストグラム ${f1(t.macdHist, 2)}(前日 ${f1(t.macdHistPrev, 2)})` });
  }
  // 4. RSI (トレンド文脈で解釈)
  {
    const r = t.rsi14;
    let s = 0;
    let why = '中立圏';
    if (r >= 80) { s = -2; why = '極端な買われ過ぎ'; }
    else if (r >= 70) { s = -1; why = '買われ過ぎ'; }
    else if (r <= 25) { s = above200 ? 2 : 1; why = '極端な売られ過ぎ'; }
    else if (r <= 30) { s = above200 ? 1.5 : 0.5; why = '売られ過ぎ'; }
    else if (r <= 45 && above200) { s = 1; why = '上昇トレンド中の押し目圏'; }
    else if (r >= 55 && r < 70 && !above200) { s = -0.5; why = '下降トレンド中の戻り'; }
    F.push({ key: 'rsi', label: 'RSI(14)', weight: 2, score: s, detail: `${f1(r)} — ${why}` });
  }
  // 5. ボリンジャー %B
  {
    const b = t.pctB;
    const s = b > 1.05 ? -1.5 : b > 0.95 ? -0.5 : b < -0.05 ? 1.5 : b < 0.05 ? 0.5 : 0;
    F.push({ key: 'bb', label: 'ボリンジャー', weight: 1, score: s, detail: `%B ${f1(b, 2)} (上限 $${f1(t.bbUpper, 2)} / 下限 $${f1(t.bbLower, 2)})` });
  }
  // 6. 出来高
  {
    let s = 0;
    if (t.volRatio >= 1.5) s = t.dayChangePct >= 0 ? 1.5 : -1.5;
    F.push({ key: 'vol', label: '出来高', weight: 1, score: s,
      detail: `20日平均比 ${f1(t.volRatio, 2)}倍 / 前日比 ${f1(t.dayChangePct, 2)}%` });
  }
  // 7. トレンド強度 (ADX)
  {
    const strong = t.adx14 >= 25;
    const s = strong ? (t.close > t.sma50 ? 1 : -1) : 0;
    F.push({ key: 'adx', label: 'トレンド強度', weight: 1, score: s,
      detail: `ADX ${f1(t.adx14)} — ${strong ? '明確なトレンド' : 'レンジ/方向感なし'}` });
  }
  // 8. 52週レンジ位置
  {
    const fromHigh = ((t.close - t.high52) / t.high52) * 100;
    let s = 0;
    if (fromHigh > -5 && above200) s = 1;
    else if (fromHigh < -30 && !above200) s = -1;
    F.push({ key: '52w', label: '52週レンジ', weight: 1, score: s,
      detail: `高値から ${f1(fromHigh)}% (高値 $${f1(t.high52, 2)} / 安値 $${f1(t.low52, 2)})` });
  }
  return toScore(F, TOTAL);
}

export function fundamentalScore(f: Fundamentals | null): Score {
  const TOTAL = 9.5;
  if (!f) return { value: null, factors: [], coverage: 0 };
  const F: Factor[] = [];

  // 1. バリュエーション
  {
    const peg = f.pegTTM;
    const pe = fin(f.forwardPE) ? f.forwardPE : f.peTTM;
    if (fin(pe) && pe <= 0) {
      F.push({ key: 'val', label: 'バリュエーション', weight: 2, score: -2, detail: '赤字 (PER 算出不可)' });
    } else if (fin(peg) && peg > 0) {
      const s = peg < 1 ? 2 : peg < 1.5 ? 1 : peg < 2.5 ? 0 : peg < 3.5 ? -1 : -2;
      F.push({ key: 'val', label: 'バリュエーション', weight: 2, score: s, detail: `PEG ${f1(peg, 2)}${fin(pe) ? ` / PER ${f1(pe)}倍` : ''}` });
    } else if (fin(pe)) {
      const s = pe < 15 ? 1.5 : pe < 25 ? 0.5 : pe < 40 ? -0.5 : -1.5;
      F.push({ key: 'val', label: 'バリュエーション', weight: 2, score: s, detail: `PER ${f1(pe)}倍` });
    }
  }
  // 2. 成長性
  {
    const rg = f.revenueGrowthTTMYoy, eg = f.epsGrowthTTMYoy;
    const parts: number[] = [];
    const lvl = (g: number) => (g > 25 ? 2 : g > 10 ? 1 : g > 0 ? 0 : g > -10 ? -1 : -2);
    if (fin(rg)) parts.push(lvl(rg));
    if (fin(eg)) parts.push(lvl(eg));
    if (parts.length) {
      F.push({ key: 'growth', label: '成長性', weight: 2, score: parts.reduce((a, b) => a + b, 0) / parts.length,
        detail: `売上成長 ${fin(rg) ? f1(rg) + '%' : 'N/A'} / EPS成長 ${fin(eg) ? f1(eg) + '%' : 'N/A'} (前年比)` });
    }
  }
  // 3. 収益性
  {
    const roe = f.roeTTM, nm = f.netMarginTTM;
    const parts: number[] = [];
    if (fin(roe)) parts.push(roe > 20 ? 2 : roe > 12 ? 1 : roe > 5 ? 0 : roe > 0 ? -1 : -2);
    if (fin(nm)) parts.push(nm > 20 ? 2 : nm > 10 ? 1 : nm > 3 ? 0 : nm > 0 ? -1 : -2);
    if (parts.length) {
      F.push({ key: 'profit', label: '収益性', weight: 2, score: parts.reduce((a, b) => a + b, 0) / parts.length,
        detail: `ROE ${fin(roe) ? f1(roe) + '%' : 'N/A'} / 純利益率 ${fin(nm) ? f1(nm) + '%' : 'N/A'}` });
    }
  }
  // 4. 財務健全性
  {
    const de = f.debtToEquity, cr = f.currentRatio;
    if (fin(de) || fin(cr)) {
      let s = fin(de) ? (de < 0.5 ? 2 : de < 1 ? 1 : de < 2 ? 0 : de < 3 ? -1 : -2) : 0;
      if (fin(cr) && cr < 1) s -= 1;
      F.push({ key: 'health', label: '財務健全性', weight: 1.5, score: clamp(s),
        detail: `D/E ${fin(de) ? f1(de, 2) : 'N/A'} / 流動比率 ${fin(cr) ? f1(cr, 2) : 'N/A'}` });
    }
  }
  // 5. アナリストコンセンサス
  if (f.analyst) {
    const a = f.analyst;
    const n = a.strongBuy + a.buy + a.hold + a.sell + a.strongSell;
    if (n > 0) {
      const avg = (2 * a.strongBuy + a.buy - a.sell - 2 * a.strongSell) / n; // -2..2
      F.push({ key: 'analyst', label: 'アナリスト', weight: 1, score: clamp(avg * 1.5),
        detail: `強買${a.strongBuy}/買${a.buy}/中立${a.hold}/売${a.sell}/強売${a.strongSell} (${a.period})` });
    }
  }
  // 6. 決算サプライズ
  if (f.epsSurprises.length) {
    const avg = f.epsSurprises.reduce((a, b) => a + b, 0) / f.epsSurprises.length;
    const beats = f.epsSurprises.filter((x) => x > 0).length;
    const s = avg > 5 ? 2 : avg > 0 ? 1 : avg > -5 ? -1 : -2;
    F.push({ key: 'surprise', label: '決算実績', weight: 1, score: s,
      detail: `直近${f.epsSurprises.length}Q 平均サプライズ ${f1(avg)}% / 予想超え ${beats}回` });
  }
  const sc = toScore(F, TOTAL);
  // 主要要因が半分未満しか取れなければ判定保留
  if (sc.coverage < 0.5) return { ...sc, value: null };
  return sc;
}

export function levelOf(score: number | null): SignalLevel {
  if (score === null) return 'PENDING';
  if (score >= 72) return 'STRONG_BUY';
  if (score >= 58) return 'BUY';
  if (score > 42) return 'HOLD';
  if (score > 28) return 'SELL';
  return 'STRONG_SELL';
}

export const LEVEL_LABEL: Record<SignalLevel, string> = {
  STRONG_BUY: '強い買い',
  BUY: '買い',
  HOLD: '中立',
  SELL: '売り',
  STRONG_SELL: '強い売り',
  PENDING: '判定保留',
};

export interface Verdict {
  composite: number | null;
  level: SignalLevel;
  tech: Score;
  fund: Score;
  warnings: string[];
}

export function daysUntil(date: string | null, now = Date.now()): number | null {
  if (!date) return null;
  return Math.ceil((new Date(date + 'T21:00:00Z').getTime() - now) / 86400000);
}

/**
 * 総合判定。blockers が 1 つでもあれば判定保留 (データ品質を最優先)。
 */
export function verdict(tech: Score, fund: Score, techWeight: number, blockers: string[], f: Fundamentals | null): Verdict {
  const warnings: string[] = [];
  if (blockers.length) return { composite: null, level: 'PENDING', tech, fund, warnings: blockers };
  if (tech.value === null) {
    return { composite: null, level: 'PENDING', tech, fund, warnings: [`日足が${MIN_BARS}本未満のためテクニカル判定不可`] };
  }
  let composite: number;
  if (fund.value === null) {
    composite = tech.value;
    warnings.push('ファンダメンタル指標不足 — テクニカルのみで判定');
  } else {
    const w = techWeight / 100;
    composite = Math.round(tech.value * w + fund.value * (1 - w));
  }
  let level = levelOf(composite);
  const d = daysUntil(f?.nextEarnings ?? null);
  if (d !== null && d >= 0 && d <= 7) {
    warnings.push(`決算発表まで${d}日 — ボラティリティ急変リスク。新規/強気判断を1段階抑制`);
    if (level === 'STRONG_BUY') level = 'BUY';
    if (level === 'STRONG_SELL') level = 'SELL';
  }
  return { composite, level, tech, fund, warnings };
}

// ===== アクションプラン =====

export interface EntryPlan {
  kind: 'entry';
  stance: 'buy_now' | 'wait_pullback' | 'avoid';
  headline: string;
  zoneLow: number | null;
  zoneHigh: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  shares: number | null;
  notes: string[];
}

export interface HoldPlan {
  kind: 'hold';
  action: 'STOP_OUT' | 'SELL' | 'TRIM' | 'TAKE_PROFIT' | 'ADD' | 'HOLD';
  headline: string;
  pnl: number;
  pnlPct: number;
  stop: number;
  trailingStop: number;
  target: number | null;
  notes: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function entryPlan(t: TechSnapshot, v: Verdict, atrMult: number, accountSize: number, riskPct: number): EntryPlan {
  const notes: string[] = [];
  const price = t.close;
  const above200 = price > t.sma200;
  if (v.level === 'PENDING') {
    return { kind: 'entry', stance: 'avoid', headline: '判定保留中 — 売買しないでください', zoneLow: null, zoneHigh: null, stop: null, target: null, rr: null, shares: null, notes: v.warnings };
  }
  if (!above200 || v.level === 'SELL' || v.level === 'STRONG_SELL') {
    notes.push(`200日線 $${r2(t.sma200)} を終値で回復するまで新規買いは見送り`);
    const headline = !above200 && (v.level === 'BUY' || v.level === 'STRONG_BUY')
      ? '200日線の下 — トレンド回復待ち'
      : !above200 ? '買い見送り (200日線の下)' : '買い見送り (スコア弱気)';
    return { kind: 'entry', stance: 'avoid', headline, zoneLow: null, zoneHigh: null, stop: null, target: null, rr: null, shares: null, notes };
  }
  // 押し目ゾーン: 20日線〜50日線 (上昇トレンド時の典型的サポート)
  const zoneHigh = Math.max(t.sma20, t.sma50);
  const zoneLow = Math.max(Math.min(t.sma20, t.sma50), t.sma200);
  // 200日線より上でゾーン上限以下 = 押し目圏。ゾーンより上でも過熱していなければ順張りエントリー可
  const pullback = price <= zoneHigh * 1.01;
  const notExtended = t.rsi14 < 60 && t.pctB < 0.8;
  const buyNow = (v.level === 'BUY' || v.level === 'STRONG_BUY') && (pullback || notExtended);
  const entry = buyNow ? price : zoneHigh;
  const stop = Math.min(entry - atrMult * t.atr14, t.low20 * 0.995);
  const risk = entry - stop;
  const target = entry + 2 * risk;
  const shares = risk > 0 ? Math.floor((accountSize * riskPct) / 100 / risk) : null;
  notes.push(`損切り = min(エントリー − ${atrMult}×ATR, 20日安値) / 目標 = リスクの2倍`);
  if (t.rsi14 >= 70) notes.push('RSI 70 超 — 高値掴み回避のため押し目待ち推奨');
  if (t.atrPct > 4) notes.push(`ボラティリティ高 (ATR ${r2(t.atrPct)}%) — ポジション縮小推奨`);
  return {
    kind: 'entry',
    stance: buyNow ? 'buy_now' : 'wait_pullback',
    headline: buyNow ? (pullback ? '押し目圏 — 買いエントリー可' : '順張り — 買いエントリー可') : `押し目待ち ($${r2(zoneLow)}–$${r2(zoneHigh)})`,
    zoneLow: r2(zoneLow), zoneHigh: r2(zoneHigh), stop: r2(stop), target: r2(target), rr: 2, shares, notes,
  };
}

export function holdPlan(h: Holding, t: TechSnapshot, v: Verdict, atrMult: number): HoldPlan {
  const price = t.close;
  const pnl = (price - h.avgCost) * h.shares;
  const pnlPct = ((price - h.avgCost) / h.avgCost) * 100;
  const initialStop = h.stopLoss ?? h.avgCost - atrMult * t.atr14;
  // シャンデリア・トレーリングストップ: 22日高値 − 3ATR (含み益時のみ切り上げ)
  const chandelier = t.high22 - 3 * t.atr14;
  const trailingStop = Math.max(initialStop, pnlPct > 0 ? chandelier : initialStop);
  const target = h.takeProfit ?? null;
  const notes: string[] = [];
  let action: HoldPlan['action'] = 'HOLD';
  let headline = '保有継続';

  if (price <= trailingStop) {
    action = 'STOP_OUT';
    headline = `ストップ到達 ($${r2(trailingStop)}) — ルール通り売却`;
  } else if (v.level === 'PENDING') {
    action = 'HOLD';
    headline = '判定保留 — データ確認まで現状維持';
    notes.push(...v.warnings);
  } else if (v.level === 'STRONG_SELL' || (v.level === 'SELL' && price < t.sma200)) {
    action = 'SELL';
    headline = '売却推奨 — トレンドとスコアが悪化';
  } else if (target !== null && price >= target) {
    action = 'TAKE_PROFIT';
    headline = `利確ライン $${r2(target)} 到達`;
  } else if (pnlPct > 20 && t.rsi14 >= 75 && t.pctB > 1) {
    action = 'TRIM';
    headline = '過熱 — 一部利確 (1/3) を検討';
  } else if (v.level === 'SELL') {
    action = 'TRIM';
    headline = 'スコア悪化 — ポジション縮小を検討';
  } else if ((v.level === 'BUY' || v.level === 'STRONG_BUY') && price > t.sma200 && price <= Math.max(t.sma20, t.sma50) * 1.01 && t.rsi14 < 60) {
    action = 'ADD';
    headline = '押し目 — 買い増し候補';
  }
  notes.push(`トレーリングストップ = max(初期ストップ, 22日高値 − 3×ATR) = $${r2(trailingStop)}`);
  if (price < t.sma200 && action === 'HOLD') notes.push('200日線割れ — 監視強化');
  return { kind: 'hold', action, headline, pnl: r2(pnl), pnlPct: r2(pnlPct), stop: r2(initialStop), trailingStop: r2(trailingStop), target, notes };
}
