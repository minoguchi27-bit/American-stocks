import { useMemo, useState } from 'react';
import { actions, useApp } from '../state/store';
import { loadSymbol, useNow } from '../state/data';
import { useAnalysis } from '../state/useAnalysis';
import StockChart from '../components/StockChart';
import { Card, FreshTag, LivePrice, ScoreRing, Sheet, SignalBadge, Skeleton } from '../components/ui';
import { HoldingForm } from '../components/HoldingForm';
import { ACTION_LABEL } from '../components/StockRow';
import { ago, bigUsd, num, pct, signed, tone, usd } from '../lib/format';
import { daysUntil } from '../lib/analysis';
import type { EntryPlan, HoldPlan, Score } from '../lib/analysis';
import { go } from '../router';

function Factors({ score }: { score: Score }) {
  if (!score.factors.length) return <div className="muted pad">データ不足</div>;
  return (
    <ul className="factors">
      {score.factors.map((f) => (
        <li key={f.key}>
          <div className="f-top">
            <span>{f.label}<small>×{f.weight}</small></span>
            <b className={tone(f.score)}>{f.score > 0 ? '+' : ''}{f.score.toFixed(1)}</b>
          </div>
          <div className="f-bar"><i className={tone(f.score)} style={{ width: `${Math.abs(f.score) * 25}%`, [f.score >= 0 ? 'left' : 'right']: '50%' }} /></div>
          <small className="muted">{f.detail}</small>
        </li>
      ))}
    </ul>
  );
}

function Stat({ k, v, t }: { k: string; v: string; t?: string }) {
  return <div className="stat"><small>{k}</small><b className={`mono ${t ?? ''}`}>{v}</b></div>;
}

export default function Detail({ symbol }: { symbol: string }) {
  const holding = useApp((s) => s.holdings.find((h) => h.symbol === symbol));
  const watched = useApp((s) => s.watchlist.some((w) => w.symbol === symbol));
  const a = useAnalysis(symbol, holding);
  const now = useNow(1000);
  const [tab, setTab] = useState<'tech' | 'fund'>('tech');
  const [edit, setEdit] = useState(false);
  const q = a.d.quote;
  const f = a.d.fund;
  const v = a.verdict;
  const plan = a.plan;

  const levels = useMemo(() => {
    const L: { price: number; color: string; title: string }[] = [];
    if (!plan) return L;
    if (plan.kind === 'hold') {
      const p = plan as HoldPlan;
      L.push({ price: p.trailingStop, color: '#ff4d6d', title: 'STOP' });
      if (holding) L.push({ price: holding.avgCost, color: '#8892b0', title: 'COST' });
      if (p.target) L.push({ price: p.target, color: '#22e39a', title: 'TP' });
    } else {
      const p = plan as EntryPlan;
      if (p.zoneHigh) L.push({ price: p.zoneHigh, color: '#3cf2ff', title: 'BUY↑' });
      if (p.zoneLow) L.push({ price: p.zoneLow, color: '#3cf2ff', title: 'BUY↓' });
      if (p.stop) L.push({ price: p.stop, color: '#ff4d6d', title: 'STOP' });
      if (p.target) L.push({ price: p.target, color: '#22e39a', title: 'TP' });
    }
    return L;
  }, [plan, holding]);

  const ed = daysUntil(f?.nextEarnings ?? null);

  return (
    <div className="page detail">
      <div className="d-head">
        <button className="icon-btn" onClick={() => history.length > 1 ? history.back() : go('/')} aria-label="戻る">‹</button>
        <div className="d-title">
          <h2>{symbol}</h2>
          <small>{f?.name ?? ''}{f?.sector ? ` · ${f.sector}` : ''}</small>
        </div>
        <button className={`icon-btn ${watched ? 'on' : ''}`} onClick={() => (watched ? actions.removeWatch(symbol) : actions.addWatch(symbol))} aria-label="ウォッチ">{watched ? '★' : '☆'}</button>
      </div>

      <div className="d-price">
        <LivePrice value={q?.price} className="big" />
        <div className={`d-chg ${tone(q?.change ?? 0)}`}>{q ? `${signed(q.change)} (${pct(q.changePct)})` : '—'}</div>
        <div className="d-meta">
          <FreshTag quote={q} />
          {q && <small className="muted">更新 {ago(q.ts, now)} · {q.source === 'finnhub-ws' ? 'WebSocket約定' : q.source === 'finnhub' ? 'Finnhub REST' : 'デモ'}</small>}
          <button className="link" onClick={() => loadSymbol(symbol, true)}>{a.d.loading ? '更新中…' : '⟳ 再取得'}</button>
        </div>
      </div>

      {a.d.errors.length > 0 && <div className="err">{a.d.errors.map((e) => <div key={e}>{e}</div>)}</div>}

      <Card className="chart-card">
        {a.candles && a.candles.length ? <StockChart candles={a.candles} levels={levels} /> : <Skeleton h={300} />}
      </Card>

      {/* 総合判定 */}
      <Card className={`verdict v-${v.level.toLowerCase()}`}>
        <div className="v-row">
          <ScoreRing value={v.composite} size={88} label="総合" />
          <div className="v-main">
            <SignalBadge level={v.level} size="lg" />
            <div className="v-sub">
              <span>テクニカル <b className="mono">{v.tech.value ?? '--'}</b></span>
              <span>ファンダ <b className="mono">{v.fund.value ?? '--'}</b></span>
            </div>
          </div>
        </div>
        {v.warnings.length > 0 && <ul className="warns">{v.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      </Card>

      {/* アクションプラン */}
      {plan?.kind === 'hold' && holding && (() => {
        const p = plan as HoldPlan;
        return (
          <Card title="保有アクション" right={<button className="link" onClick={() => setEdit(true)}>編集</button>}>
            <div className={`plan-head act-${p.action.toLowerCase()}`}><span>{ACTION_LABEL[p.action]}</span>{p.headline}</div>
            <div className="stats">
              <Stat k="保有" v={`${holding.shares}株`} />
              <Stat k="取得単価" v={usd(holding.avgCost)} />
              <Stat k="含み損益" v={`${signed(p.pnl, 0)}`} t={tone(p.pnl)} />
              <Stat k="損益率" v={pct(p.pnlPct)} t={tone(p.pnlPct)} />
              <Stat k="初期ストップ" v={usd(p.stop)} />
              <Stat k="トレーリング" v={usd(p.trailingStop)} t="down" />
              <Stat k="利確ライン" v={usd(p.target)} t="up" />
              <Stat k="ストップまで" v={q ? pct(((p.trailingStop - q.price) / q.price) * 100) : '—'} />
            </div>
            <ul className="notes">{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </Card>
        );
      })()}
      {plan?.kind === 'entry' && (() => {
        const p = plan as EntryPlan;
        return (
          <Card title="エントリープラン" right={<button className="link" onClick={() => setEdit(true)}>＋ 保有に追加</button>}>
            <div className={`plan-head stance-${p.stance}`}>{p.headline}</div>
            {p.zoneLow != null && (
              <div className="stats">
                <Stat k="買いゾーン" v={`${usd(p.zoneLow)}–${usd(p.zoneHigh)}`} />
                <Stat k="損切り" v={usd(p.stop)} t="down" />
                <Stat k="目標 (2R)" v={usd(p.target)} t="up" />
                <Stat k="推奨株数" v={p.shares != null ? `${p.shares}株` : '—'} />
              </div>
            )}
            <ul className="notes">{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </Card>
        );
      })()}

      {/* 根拠 */}
      <Card title="判定根拠" right={
        <div className="seg">
          <button className={tab === 'tech' ? 'on' : ''} onClick={() => setTab('tech')}>テクニカル</button>
          <button className={tab === 'fund' ? 'on' : ''} onClick={() => setTab('fund')}>ファンダ</button>
        </div>}>
        <Factors score={tab === 'tech' ? v.tech : v.fund} />
        {tab === 'fund' && f && <small className="muted pad">財務データ取得 {ago(f.fetchedAt, now)} / カバレッジ {Math.round(v.fund.coverage * 100)}%</small>}
      </Card>

      {a.snap && (
        <Card title="主要指標">
          <div className="stats">
            <Stat k="RSI(14)" v={num(a.snap.rsi14, 1)} t={a.snap.rsi14 > 70 ? 'down' : a.snap.rsi14 < 30 ? 'up' : ''} />
            <Stat k="ATR(14)" v={`${usd(a.snap.atr14)} (${num(a.snap.atrPct, 1)}%)`} />
            <Stat k="MA50" v={usd(a.snap.sma50)} />
            <Stat k="MA200" v={usd(a.snap.sma200)} />
            <Stat k="ADX" v={num(a.snap.adx14, 1)} />
            <Stat k="出来高比" v={`${num(a.snap.volRatio, 2)}x`} />
            <Stat k="52週高値" v={usd(a.snap.high52)} />
            <Stat k="52週安値" v={usd(a.snap.low52)} />
          </div>
        </Card>
      )}

      {f && (
        <Card title="ファンダメンタル" right={ed !== null && ed >= 0 ? <span className={`chip ${ed <= 7 ? 'warn' : ''}`}>決算 {f.nextEarnings} ({ed}日後)</span> : null}>
          <div className="stats">
            <Stat k="時価総額" v={bigUsd(f.marketCap)} />
            <Stat k="PER (TTM)" v={num(f.peTTM, 1)} />
            <Stat k="予想PER" v={num(f.forwardPE, 1)} />
            <Stat k="PEG" v={num(f.pegTTM, 2)} />
            <Stat k="PSR" v={num(f.psTTM, 1)} />
            <Stat k="PBR" v={num(f.pbQ, 1)} />
            <Stat k="売上成長" v={pct(f.revenueGrowthTTMYoy, 1)} t={tone(f.revenueGrowthTTMYoy ?? 0)} />
            <Stat k="EPS成長" v={pct(f.epsGrowthTTMYoy, 1)} t={tone(f.epsGrowthTTMYoy ?? 0)} />
            <Stat k="ROE" v={pct(f.roeTTM, 1, false)} />
            <Stat k="純利益率" v={pct(f.netMarginTTM, 1, false)} />
            <Stat k="D/E" v={num(f.debtToEquity, 2)} />
            <Stat k="配当利回り" v={pct(f.dividendYield, 2, false)} />
          </div>
        </Card>
      )}

      <Card title="データ品質チェック" right={<span className={`chip ${a.integrity.blockers.length ? 'bad' : 'ok'}`}>{a.integrity.blockers.length ? 'NG' : 'PASS'}</span>}>
        <ul className="checks">
          {a.integrity.checks.map((c) => (
            <li key={c.label}><i className={c.ok ? 'ok' : 'bad'}>{c.ok ? '✓' : '✕'}</i><span>{c.label}</span><small>{c.detail}</small></li>
          ))}
          {a.d.candlesAt && <li><i className="ok">i</i><span>日足取得</span><small>{ago(a.d.candlesAt, now)} · {a.d.candles?.length ?? 0}本</small></li>}
        </ul>
      </Card>

      <Sheet open={edit} onClose={() => setEdit(false)} title={holding ? `${symbol} を編集` : `${symbol} を保有に追加`}>
        <HoldingForm initial={holding} symbol={symbol} onDone={() => setEdit(false)} />
      </Sheet>
    </div>
  );
}
