import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type { Candle } from '../lib/types';
import { bollinger, macd, rsi, sma } from '../lib/indicators';

type Range = '3M' | '6M' | '1Y' | 'ALL';
const RANGE_BARS: Record<Range, number> = { '3M': 63, '6M': 126, '1Y': 252, ALL: 10000 };

interface Props {
  candles: Candle[];
  levels?: { price: number; color: string; title: string }[];
}

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export default function StockChart({ candles, levels = [] }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<Record<string, ISeriesApi<'Candlestick' | 'Line' | 'Histogram'>>>({});
  const [range, setRange] = useState<Range>('6M');
  const [overlay, setOverlay] = useState<'MA' | 'BB'>('MA');
  const [lower, setLower] = useState<'RSI' | 'MACD'>('RSI');

  // チャート生成 (オーバーレイ/下段指標の切替時に再構築)
  useEffect(() => {
    if (!el.current) return;
    const up = css('--up'), down = css('--down'), grid = css('--grid'), text = css('--muted');
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 10, panes: { separatorColor: grid } },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, rightOffset: 3 },
      handleScroll: { vertTouchDrag: false },
    });
    const s: typeof series.current = {};
    s.candle = c.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
    s.vol = c.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const line = (color: string, width = 1, style: LineStyle = LineStyle.Solid, pane = 0) =>
      c.addSeries(LineSeries, { color, lineWidth: width as 1, lineStyle: style, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }, pane);
    if (overlay === 'MA') {
      s.ma20 = line('#ffd166');
      s.ma50 = line('#3cf2ff');
      s.ma200 = line('#c77dff', 2);
    } else {
      s.bbU = line('#3cf2ff', 1, LineStyle.Dashed);
      s.bbM = line('#8892b0', 1, LineStyle.Dotted);
      s.bbL = line('#3cf2ff', 1, LineStyle.Dashed);
    }
    if (lower === 'RSI') {
      s.rsi = line('#ffd166', 1, LineStyle.Solid, 1);
      s.rsi.createPriceLine({ price: 70, color: down, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
      s.rsi.createPriceLine({ price: 30, color: up, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' });
    } else {
      s.hist = c.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, 1);
      s.macd = line('#3cf2ff', 1, LineStyle.Solid, 1);
      s.sig = line('#ff9f1c', 1, LineStyle.Solid, 1);
    }
    const panes = c.panes();
    if (panes[1]) panes[1].setHeight(90);
    chart.current = c;
    series.current = s;
    return () => {
      chart.current = null;
      // 保留中の描画フレームを消化してから破棄 (lightweight-charts の "Object is disposed" 回避)
      requestAnimationFrame(() => requestAnimationFrame(() => c.remove()));
    };
  }, [overlay, lower]);

  // データ反映
  useEffect(() => {
    const c = chart.current;
    const s = series.current;
    if (!c || candles.length === 0) return;
    const up = css('--up'), down = css('--down');
    const t = (i: number) => candles[i].time as Time;
    const closes = candles.map((x) => x.close);
    const toLine = (arr: number[]) => arr.map((v, i) => ({ time: t(i), value: v })).filter((p) => Number.isFinite(p.value));
    s.candle.setData(candles.map((x) => ({ time: x.time as Time, open: x.open, high: x.high, low: x.low, close: x.close })));
    s.vol.setData(candles.map((x, i) => ({ time: t(i), value: x.volume, color: (i > 0 && x.close >= candles[i - 1].close ? up : down) + '55' })));
    if (s.ma20) { s.ma20.setData(toLine(sma(closes, 20))); s.ma50.setData(toLine(sma(closes, 50))); s.ma200.setData(toLine(sma(closes, 200))); }
    if (s.bbU) { const b = bollinger(closes); s.bbU.setData(toLine(b.upper)); s.bbM.setData(toLine(b.mid)); s.bbL.setData(toLine(b.lower)); }
    if (s.rsi) s.rsi.setData(toLine(rsi(closes)));
    if (s.hist) {
      const m = macd(closes);
      s.hist.setData(m.hist.map((v, i) => ({ time: t(i), value: v, color: (v >= 0 ? up : down) + 'aa' })).filter((p) => Number.isFinite(p.value)));
      s.macd.setData(toLine(m.line));
      s.sig.setData(toLine(m.signal));
    }
    // 売買ライン
    const candleSeries = s.candle as ISeriesApi<'Candlestick'>;
    const lines = levels.map((l) => candleSeries.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: l.title }));
    return () => {
      // チャート再構築時は既に破棄済みのため例外を無視
      try { lines.forEach((pl) => candleSeries.removePriceLine(pl)); } catch { /* disposed */ }
    };
  }, [candles, levels, overlay, lower]);

  // 表示期間
  useEffect(() => {
    const c = chart.current;
    if (!c || candles.length === 0) return;
    const n = Math.min(RANGE_BARS[range], candles.length);
    c.timeScale().setVisibleLogicalRange({ from: candles.length - n, to: candles.length + 2 });
  }, [range, candles.length, overlay, lower]);

  return (
    <div className="chart-wrap">
      <div className="seg-row">
        <div className="seg">
          {(Object.keys(RANGE_BARS) as Range[]).map((r) => (
            <button key={r} className={r === range ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
        <div className="seg">
          {(['MA', 'BB'] as const).map((o) => <button key={o} className={o === overlay ? 'on' : ''} onClick={() => setOverlay(o)}>{o}</button>)}
          {(['RSI', 'MACD'] as const).map((o) => <button key={o} className={o === lower ? 'on' : ''} onClick={() => setLower(o)}>{o}</button>)}
        </div>
      </div>
      <div ref={el} className="chart" />
      <div className="legend">
        {overlay === 'MA' ? (<><i style={{ background: '#ffd166' }} />MA20<i style={{ background: '#3cf2ff' }} />MA50<i style={{ background: '#c77dff' }} />MA200</>)
          : (<><i style={{ background: '#3cf2ff' }} />BB(20,2σ)</>)}
        {lower === 'MACD' && (<><i style={{ background: '#3cf2ff' }} />MACD<i style={{ background: '#ff9f1c' }} />Signal</>)}
      </div>
    </div>
  );
}
