import { useState } from 'react';
import { actions, normalizeSymbol, useApp } from '../state/store';
import { StockRow } from '../components/StockRow';
import { Empty, Sheet } from '../components/ui';
import { HoldingForm } from '../components/HoldingForm';
import { fhSearch } from '../lib/providers/finnhub';
import { go } from '../router';

export function HoldingsPage() {
  const holdings = useApp((s) => s.holdings);
  const [open, setOpen] = useState(false);
  return (
    <div className="page">
      <div className="page-h">
        <h2>保有銘柄 <small>{holdings.length}</small></h2>
        <button className="btn-pri sm" onClick={() => setOpen(true)}>＋ 追加</button>
      </div>
      <div className="list">
        {holdings.map((h) => <StockRow key={h.id} symbol={h.symbol} holding={h} onOpen={() => go(`/s/${h.symbol}`)} />)}
        {!holdings.length && <Empty>保有銘柄がありません。「＋ 追加」から登録</Empty>}
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="保有銘柄を追加">
        <HoldingForm onDone={() => setOpen(false)} />
      </Sheet>
    </div>
  );
}

export function WatchPage() {
  const watch = useApp((s) => s.watchlist);
  const key = useApp((s) => s.settings.finnhubKey);
  const demo = useApp((s) => s.settings.demoMode);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ symbol: string; description: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const search = async () => {
    setErr('');
    const sym = normalizeSymbol(q);
    if (!sym) return;
    if (demo || !key) { setRes([{ symbol: sym, description: 'ティッカーを直接追加' }]); return; }
    setBusy(true);
    try {
      const r = await fhSearch(q, key);
      setRes(r.length ? r : [{ symbol: sym, description: '候補なし — ティッカーを直接追加' }]);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-h">
        <h2>ウォッチリスト <small>{watch.length}</small></h2>
        <button className="btn-pri sm" onClick={() => { setOpen(true); setRes([]); setQ(''); }}>＋ 追加</button>
      </div>
      <div className="list">
        {watch.map((w) => <StockRow key={w.symbol} symbol={w.symbol} onOpen={() => go(`/s/${w.symbol}`)} />)}
        {!watch.length && <Empty>検討中の銘柄を追加してください</Empty>}
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="銘柄を検索">
        <form className="search" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ティッカー / 社名 (例: AAPL)" autoCapitalize="characters" />
          <button className="btn-pri" disabled={busy}>{busy ? '…' : '検索'}</button>
        </form>
        {err && <div className="err">{err}</div>}
        <div className="results">
          {res.map((r) => (
            <button key={r.symbol} className="result" onClick={() => { actions.addWatch(r.symbol); setOpen(false); }}>
              <b>{r.symbol}</b><span>{r.description}</span><i>＋</i>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
