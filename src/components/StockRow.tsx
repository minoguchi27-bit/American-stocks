import type { Holding } from '../lib/types';
import { useAnalysis } from '../state/useAnalysis';
import { LivePrice, ScoreRing, SignalBadge, FreshTag } from './ui';
import { pct, signed, tone, usd } from '../lib/format';
import type { HoldPlan, EntryPlan } from '../lib/analysis';

export const ACTION_LABEL: Record<HoldPlan['action'], string> = {
  STOP_OUT: '損切り', SELL: '売却', TRIM: '一部売却', TAKE_PROFIT: '利確', ADD: '買い増し', HOLD: '保有継続',
};

export function StockRow({ symbol, holding, onOpen }: { symbol: string; holding?: Holding; onOpen: () => void }) {
  const a = useAnalysis(symbol, holding);
  const q = a.d.quote;
  const hp = a.plan?.kind === 'hold' ? (a.plan as HoldPlan) : null;
  const ep = a.plan?.kind === 'entry' ? (a.plan as EntryPlan) : null;
  return (
    <button className="row" onClick={onOpen}>
      <ScoreRing value={a.verdict.composite} size={48} />
      <div className="row-main">
        <div className="row-top">
          <b className="sym">{symbol}</b>
          <SignalBadge level={a.verdict.level} size="sm" />
          <FreshTag quote={q} />
        </div>
        <div className="row-sub">
          {a.d.fund?.name ?? (a.d.loading ? '読み込み中…' : a.d.errors[0] ?? '')}
        </div>
        {hp && (
          <div className={`row-act act-${hp.action.toLowerCase()}`}>
            <span>{ACTION_LABEL[hp.action]}</span>
            <small>{hp.headline}</small>
          </div>
        )}
        {ep && <div className={`row-act stance-${ep.stance}`}><small>{ep.headline}</small></div>}
      </div>
      <div className="row-px">
        <LivePrice value={q?.price} className="px" />
        <span className={`chg ${tone(q?.changePct ?? 0)}`}>{pct(q?.changePct)}</span>
        {hp && <span className={`pnl ${tone(hp.pnl)}`}>{signed(hp.pnl, 0)} <small>{pct(hp.pnlPct, 1)}</small></span>}
        {!hp && ep?.stance === 'wait_pullback' && ep.zoneLow != null && <span className="zone">{usd(ep.zoneLow, 0)}–{usd(ep.zoneHigh, 0)}</span>}
      </div>
    </button>
  );
}
