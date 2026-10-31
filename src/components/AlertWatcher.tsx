import { useEffect } from 'react';
import type { Holding } from '../lib/types';
import { alertFor, nextMemo, shouldNotify } from '../lib/alerts';
import { nyParts } from '../lib/market';
import { useApp } from '../state/store';
import { useAnalysis } from '../state/useAnalysis';
import { dismissToast, loadMemo, saveMemo, showAlert, useToasts } from '../state/notify';
import { go } from '../router';

/** 1 銘柄のシグナル変化を監視して通知 */
function Probe({ symbol, holding }: { symbol: string; holding?: Holding }) {
  const a = useAnalysis(symbol, holding);
  const price = a.d.quote?.price ?? null;
  const alert = a.plan ? alertFor(symbol, a, price) : null;
  const state = alert?.state;
  useEffect(() => {
    // データ未取得・デモデータでは通知しない
    if (!alert || a.demo || !a.d.quote) return;
    const key = holding ? `h:${holding.id}` : `w:${symbol}`;
    const today = nyParts().date;
    const memo = loadMemo();
    const send = shouldNotify(alert, memo[key], today);
    if (send) showAlert(alert);
    memo[key] = nextMemo(alert, memo[key], today, send);
    saveMemo(memo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, a.demo, symbol, holding?.id]);
  return null;
}

export function AlertWatcher() {
  const enabled = useApp((s) => s.settings.notifyInApp);
  const holdings = useApp((s) => s.holdings);
  const watch = useApp((s) => s.watchlist);
  if (!enabled) return null;
  return (
    <>
      {holdings.map((h) => <Probe key={h.id} symbol={h.symbol} holding={h} />)}
      {watch.filter((w) => !holdings.some((h) => h.symbol === w.symbol)).map((w) => <Probe key={w.symbol} symbol={w.symbol} />)}
    </>
  );
}

export function Toasts() {
  const list = useToasts();
  if (!list.length) return null;
  return (
    <div className="toasts">
      {list.map((t) => (
        <button key={t.id} className={`toast toast-${t.priority}`} onClick={() => { dismissToast(t.id); if (t.symbol) go(`/s/${t.symbol}`); }}>
          <b>{t.title}</b>
          <span>{t.body}</span>
        </button>
      ))}
    </div>
  );
}
