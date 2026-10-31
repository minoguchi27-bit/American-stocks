import { useApp } from '../state/store';
import { useSymbols } from '../state/data';
import { useAnalysis } from '../state/useAnalysis';
import { Card, Empty, LivePrice } from '../components/ui';
import { ACTION_LABEL } from '../components/StockRow';
import { pct, signed, tone, usd } from '../lib/format';
import type { HoldPlan } from '../lib/analysis';
import type { Holding } from '../lib/types';
import { LEVEL_LABEL } from '../lib/analysis';
import { go } from '../router';

function ValueAgg({ holdings }: { holdings: Holding[] }) {
  const ds = useSymbols(holdings.map((h) => h.symbol));
  const vals = holdings.map((h, i) => {
    const q = ds[i].quote;
    return q ? { value: q.price * h.shares, cost: h.avgCost * h.shares, day: (q.price - q.prevClose) * h.shares } : null;
  });
  const ready = vals.every(Boolean);
  const total = vals.reduce((s, v) => s + (v?.value ?? 0), 0);
  const cost = vals.reduce((s, v) => s + (v?.cost ?? 0), 0);
  const day = vals.reduce((s, v) => s + (v?.day ?? 0), 0);
  const pnl = total - cost;
  return (
    <div className="hero">
      <div className="hero-label">保有評価額</div>
      <div className="hero-val"><LivePrice value={ready ? total : null} /></div>
      <div className="hero-sub">
        <span className={tone(day)}>本日 {signed(day, 0)} ({pct(total - day ? (day / (total - day)) * 100 : 0)})</span>
        <span className={tone(pnl)}>含み損益 {signed(pnl, 0)} ({pct(cost ? (pnl / cost) * 100 : 0)})</span>
      </div>
      {!ready && <div className="hero-note">一部銘柄の株価を取得中…</div>}
    </div>
  );
}

function ActionItem({ symbol, holding }: { symbol: string; holding?: Holding }) {
  const a = useAnalysis(symbol, holding);
  const p = a.plan;
  if (!p) return null;
  if (p.kind === 'hold') {
    const hp = p as HoldPlan;
    if (hp.action === 'HOLD') return null;
    return (
      <button className={`alert act-${hp.action.toLowerCase()}`} onClick={() => go(`/s/${symbol}`)}>
        <span className="alert-tag">{ACTION_LABEL[hp.action]}</span>
        <div><b>{symbol}</b><small>{hp.headline}</small></div>
        <span className="mono">{usd(a.d.quote?.price)}</span>
      </button>
    );
  }
  if (p.stance !== 'buy_now') return null;
  return (
    <button className="alert act-add" onClick={() => go(`/s/${symbol}`)}>
      <span className="alert-tag">{LEVEL_LABEL[a.verdict.level]}</span>
      <div><b>{symbol}</b><small>{p.headline} / 損切り {usd(p.stop)}</small></div>
      <span className="mono">{usd(a.d.quote?.price)}</span>
    </button>
  );
}

function Heat({ symbol }: { symbol: string }) {
  const a = useAnalysis(symbol);
  const v = a.verdict.composite;
  const hue = v === null ? 'var(--panel2)' : `color-mix(in oklab, ${v >= 50 ? 'var(--up)' : 'var(--down)'} ${Math.min(100, Math.abs(v - 50) * 2.4)}%, var(--panel2))`;
  return (
    <button className="heat" style={{ background: hue }} onClick={() => go(`/s/${symbol}`)}>
      <b>{symbol}</b>
      <span className="mono">{v ?? '--'}</span>
      <small className={tone(a.d.quote?.changePct ?? 0)}>{pct(a.d.quote?.changePct, 1)}</small>
    </button>
  );
}

export default function Home() {
  const holdings = useApp((s) => s.holdings);
  const watch = useApp((s) => s.watchlist);
  const symbols = Array.from(new Set([...holdings.map((h) => h.symbol), ...watch.map((w) => w.symbol)]));
  return (
    <div className="page">
      <ValueAgg holdings={holdings} />
      <Card title="要アクション" right={<small className="muted">ルール判定</small>}>
        <div className="alerts">
          {holdings.map((h) => <ActionItem key={h.id} symbol={h.symbol} holding={h} />)}
          {watch.filter((w) => !holdings.some((h) => h.symbol === w.symbol)).map((w) => <ActionItem key={w.symbol} symbol={w.symbol} />)}
        </div>
        <Empty>表示されていない銘柄は「保有継続 / 押し目待ち / 見送り」です</Empty>
      </Card>
      <Card title="シグナルマップ" right={<small className="muted">総合スコア 0–100</small>}>
        {symbols.length ? <div className="heatgrid">{symbols.map((s) => <Heat key={s} symbol={s} />)}</div> : <Empty>銘柄を追加してください</Empty>}
      </Card>
    </div>
  );
}
