// ===== データ品質ゲート =====
// 「古い・欠損・矛盾したデータで売買判断しない」ためのチェック。
// 1 つでも blocker があれば総合判定は PENDING になる。

import type { Candle, Freshness, Quote } from './types';
import { lastTradingDate, marketSession, nyParts, tradingDaysBetween } from './market';

export const MAX_CROSS_DEVIATION_PCT = 1.0;

export function quoteFreshness(q: Quote | null, now = Date.now()): Freshness {
  if (!q) return 'none';
  const session = marketSession(now);
  const age = (now - q.ts) / 1000;
  if (session !== 'regular') {
    // 時間外: 直近取引日の終値相当であれば有効
    return 'closed';
  }
  if (age < 20 && q.source === 'finnhub-ws') return 'live';
  if (age < 90) return 'fresh';
  if (age < 15 * 60) return 'delayed';
  return 'stale';
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  live: 'LIVE',
  fresh: 'REALTIME',
  delayed: 'DELAYED',
  stale: 'STALE',
  closed: 'CLOSE',
  none: 'NO DATA',
};

export interface IntegrityReport {
  blockers: string[];
  warnings: string[];
  checks: { label: string; ok: boolean; detail: string }[];
}

export function checkIntegrity(candles: Candle[], quote: Quote | null, now = Date.now()): IntegrityReport {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const checks: IntegrityReport['checks'] = [];

  // 1. 気配の鮮度
  const fr = quoteFreshness(quote, now);
  const qOk = fr !== 'none' && fr !== 'stale';
  checks.push({ label: '株価の鮮度', ok: qOk, detail: quote ? `${FRESHNESS_LABEL[fr]} / ${new Date(quote.ts).toLocaleTimeString('ja-JP')}` : '取得失敗' });
  if (fr === 'none') blockers.push('リアルタイム株価を取得できません');
  if (fr === 'stale') blockers.push('株価が15分以上更新されていません (取引時間中)');
  if (fr === 'delayed') warnings.push('株価が遅延しています');

  // 2. 日足の連続性 (最終足が直近営業日か)
  if (candles.length === 0) {
    blockers.push('日足データがありません');
    checks.push({ label: '日足の最新性', ok: false, detail: 'データなし' });
  } else {
    const lastDate = candles[candles.length - 1].time;
    const expected = lastTradingDate(now);
    // 当日足の未確定・EOD 配信の遅延を考慮し 1 営業日の遅れまで許容
    const lag = tradingDaysBetween(lastDate, expected);
    const ok = lag <= 1;
    checks.push({ label: '日足の最新性', ok, detail: `最終足 ${lastDate} (期待 ${expected}, 差 ${lag}営業日)` });
    if (!ok) blockers.push(`日足が${lag}営業日古いです (最終 ${lastDate})`);

    // 3. 異常値 (0 / 負値 / high<low)
    const bad = candles.filter((c) => !(c.close > 0 && c.high >= c.low && c.high >= c.close && c.low <= c.close));
    checks.push({ label: 'OHLC 整合性', ok: bad.length === 0, detail: bad.length ? `${bad.length}本に異常` : `${candles.length}本 正常` });
    if (bad.length) blockers.push(`OHLC に異常値 ${bad.length} 本`);

    // 4. ソース間クロスチェック: 日足の前日終値 vs 気配の前日終値
    if (quote && quote.prevClose > 0) {
      // 気配の取引日と同じ日足があればその前日足、なければ最終足が「前日終値」
      const quoteDate = nyParts(quote.ts).date;
      const ref = lastDate >= quoteDate && candles.length > 1
        ? candles[candles.length - 2].close
        : candles[candles.length - 1].close;
      const dev = (Math.abs(ref - quote.prevClose) / quote.prevClose) * 100;
      const ok2 = dev <= MAX_CROSS_DEVIATION_PCT;
      checks.push({ label: 'ソース間照合', ok: ok2, detail: `前日終値 日足 $${ref.toFixed(2)} / 気配 $${quote.prevClose.toFixed(2)} (乖離 ${dev.toFixed(2)}%)` });
      if (!ok2) blockers.push(`データソース間で前日終値が ${dev.toFixed(2)}% 乖離 (分割/配当調整の可能性)`);
    }
  }
  return { blockers, warnings, checks };
}
