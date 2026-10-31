// ===== 通知ルール (アプリ内通知とサーバー通知で共用) =====

import type { EntryPlan, HoldPlan } from './analysis';
import type { EngineResult } from './engine';

export type AlertPriority = 'urgent' | 'high' | 'default';

export interface Alert {
  symbol: string;
  /** 状態キー。同じキーが続く間は再通知しない */
  state: string;
  title: string;
  body: string;
  priority: AlertPriority;
}

const HOLD_ALERT: Partial<Record<HoldPlan['action'], { label: string; priority: AlertPriority; emoji: string }>> = {
  STOP_OUT: { label: '損切り', priority: 'urgent', emoji: '🛑' },
  SELL: { label: '売却推奨', priority: 'urgent', emoji: '🔻' },
  TAKE_PROFIT: { label: '利確', priority: 'high', emoji: '💰' },
  TRIM: { label: '一部売却', priority: 'high', emoji: '✂️' },
  ADD: { label: '買い増し候補', priority: 'default', emoji: '➕' },
};

const $ = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);

/**
 * 判定結果から通知すべき内容を返す。
 * 通知不要 (保有継続・押し目待ち・見送り・判定保留) でも state は返し、状態遷移の検出に使う。
 */
export function alertFor(symbol: string, r: EngineResult, price: number | null): Alert & { notify: boolean } {
  const p = r.plan;
  const base = { symbol, title: '', body: '', priority: 'default' as AlertPriority };
  // データ品質 NG のときは売買通知を出さない (判定保留)
  if (!p || r.verdict.level === 'PENDING') {
    // ただし損切り到達は価格のみで判定できるため保留中でも通知する
    if (p?.kind === 'hold' && p.action === 'STOP_OUT') return { ...stopOut(symbol, p, price), notify: true };
    return { ...base, state: 'PENDING', notify: false };
  }
  if (p.kind === 'hold') {
    const h = p as HoldPlan;
    const a = HOLD_ALERT[h.action];
    if (!a) return { ...base, state: `HOLD:${h.action}`, notify: false };
    if (h.action === 'STOP_OUT') return { ...stopOut(symbol, h, price), notify: true };
    return {
      symbol, state: `HOLD:${h.action}`, priority: a.priority, notify: true,
      title: `${a.emoji} ${symbol} ${a.label}`,
      body: `${h.headline}\n現在値 ${$(price)} / 損益 ${h.pnlPct > 0 ? '+' : ''}${h.pnlPct.toFixed(1)}% / ストップ ${$(h.trailingStop)}`,
    };
  }
  const e = p as EntryPlan;
  if (e.stance !== 'buy_now') return { ...base, state: `ENTRY:${e.stance}`, notify: false };
  return {
    symbol, state: 'ENTRY:buy_now', priority: 'default', notify: true,
    title: `🟢 ${symbol} 買いシグナル (スコア ${r.verdict.composite})`,
    body: `${e.headline}\n現在値 ${$(price)} / 損切り ${$(e.stop)} / 目標 ${$(e.target)}${e.shares != null ? ` / 推奨 ${e.shares}株` : ''}`,
  };
}

function stopOut(symbol: string, h: HoldPlan, price: number | null): Alert {
  return {
    symbol, state: 'HOLD:STOP_OUT', priority: 'urgent',
    title: `🛑 ${symbol} 損切りライン到達`,
    body: `現在値 ${$(price)} ≤ ストップ ${$(h.trailingStop)} — ルール通り売却を検討\n損益 ${h.pnlPct > 0 ? '+' : ''}${h.pnlPct.toFixed(1)}%`,
  };
}

export interface AlertMemo {
  state: string;
  /** 最後に通知した NY 日付 */
  notifiedOn?: string;
}

/**
 * 通知するかどうか: 状態が変わったとき。
 * 緊急 (損切り/売却) は状態が続いていても 1 取引日に 1 回は再通知する。
 */
export function shouldNotify(a: Alert & { notify: boolean }, prev: AlertMemo | undefined, today: string): boolean {
  if (!a.notify) return false;
  if (!prev || prev.state !== a.state) return true;
  return a.priority === 'urgent' && prev.notifiedOn !== today;
}

export function nextMemo(a: Alert & { notify: boolean }, prev: AlertMemo | undefined, today: string, sent: boolean): AlertMemo {
  // 一時的なデータ不良 (判定保留) で状態を上書きしない — 復帰時の重複通知を防ぐ
  if (a.state === 'PENDING' && prev) return prev;
  return { state: a.state, notifiedOn: sent ? today : prev?.state === a.state ? prev.notifiedOn : undefined };
}
