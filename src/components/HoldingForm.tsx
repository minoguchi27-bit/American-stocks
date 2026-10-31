import { useState } from 'react';
import type { Holding } from '../lib/types';
import { actions, normalizeSymbol } from '../state/store';

export function HoldingForm({ initial, symbol, onDone }: { initial?: Holding; symbol?: string; onDone: () => void }) {
  const [f, setF] = useState({
    symbol: initial?.symbol ?? symbol ?? '',
    shares: initial?.shares?.toString() ?? '',
    avgCost: initial?.avgCost?.toString() ?? '',
    boughtAt: initial?.boughtAt ?? new Date().toISOString().slice(0, 10),
    stopLoss: initial?.stopLoss?.toString() ?? '',
    takeProfit: initial?.takeProfit?.toString() ?? '',
    memo: initial?.memo ?? '',
  });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = normalizeSymbol(f.symbol);
    const shares = Number(f.shares), cost = Number(f.avgCost);
    const sl = f.stopLoss ? Number(f.stopLoss) : undefined;
    const tp = f.takeProfit ? Number(f.takeProfit) : undefined;
    if (!sym) return setErr('ティッカーを入力してください');
    if (!(shares > 0)) return setErr('株数は正の数で入力してください');
    if (!(cost > 0)) return setErr('平均取得単価は正の数で入力してください');
    if (sl !== undefined && !(sl > 0 && sl < cost * 10)) return setErr('損切りラインが不正です');
    if (tp !== undefined && !(tp > 0)) return setErr('利確ラインが不正です');
    if (sl !== undefined && tp !== undefined && sl >= tp) return setErr('損切りは利確より低く設定してください');
    actions.upsertHolding({
      id: initial?.id ?? crypto.randomUUID(), symbol: sym, shares, avgCost: cost, boughtAt: f.boughtAt,
      stopLoss: sl, takeProfit: tp, memo: f.memo || undefined,
    });
    onDone();
  };

  return (
    <form className="form" onSubmit={submit}>
      <label>ティッカー<input value={f.symbol} onChange={set('symbol')} placeholder="AAPL" autoCapitalize="characters" disabled={!!initial} /></label>
      <div className="grid2">
        <label>株数<input inputMode="decimal" value={f.shares} onChange={set('shares')} placeholder="10" /></label>
        <label>平均取得単価 ($)<input inputMode="decimal" value={f.avgCost} onChange={set('avgCost')} placeholder="185.20" /></label>
      </div>
      <label>取得日<input type="date" value={f.boughtAt} onChange={set('boughtAt')} /></label>
      <div className="grid2">
        <label>損切り ($) <small>任意</small><input inputMode="decimal" value={f.stopLoss} onChange={set('stopLoss')} placeholder="自動: 2×ATR" /></label>
        <label>利確 ($) <small>任意</small><input inputMode="decimal" value={f.takeProfit} onChange={set('takeProfit')} placeholder="未設定" /></label>
      </div>
      <label>メモ<input value={f.memo} onChange={set('memo')} placeholder="投資テーマなど" /></label>
      {err && <div className="err">{err}</div>}
      <div className="form-actions">
        {initial && <button type="button" className="btn-danger" onClick={() => { if (confirm(`${initial.symbol} を削除しますか？`)) { actions.removeHolding(initial.id); onDone(); } }}>削除</button>}
        <button className="btn-pri">{initial ? '更新' : '追加'}</button>
      </div>
    </form>
  );
}
