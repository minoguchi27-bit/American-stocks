import { useState } from 'react';
import { actions, useApp } from '../state/store';
import { resetData } from '../state/data';
import { cacheClear } from '../lib/providers/http';
import { fhQuote } from '../lib/providers/finnhub';
import { tdDaily } from '../lib/providers/twelvedata';
import { Card } from '../components/ui';

export default function SettingsPage() {
  const s = useApp((x) => x.settings);
  const [fk, setFk] = useState(s.finnhubKey);
  const [tk, setTk] = useState(s.twelveDataKey);
  const [test, setTest] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [io, setIo] = useState('');

  const save = async () => {
    setBusy(true);
    const log: string[] = [];
    try { const q = await fhQuote('AAPL', fk.trim()); log.push(`✓ Finnhub OK (AAPL $${q.price})`); } catch (e) { log.push(`✕ Finnhub: ${(e as Error).message}`); }
    try { const d = await tdDaily('AAPL', tk.trim(), true); log.push(`✓ Twelve Data OK (日足 ${d.candles.length}本)`); } catch (e) { log.push(`✕ Twelve Data: ${(e as Error).message}`); }
    setTest(log);
    const ok = log.every((l) => l.startsWith('✓'));
    actions.updateSettings({ finnhubKey: fk.trim(), twelveDataKey: tk.trim(), demoMode: !ok });
    cacheClear();
    resetData();
    setBusy(false);
  };

  const num = (k: 'techWeight' | 'atrStopMult' | 'riskPerTradePct' | 'accountSize') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) actions.updateSettings({ [k]: v });
  };

  return (
    <div className="page">
      <div className="page-h"><h2>設定</h2></div>

      <Card title="データソース (API キー)">
        <p className="muted small">実データで運用するには無料 API キー 2 つが必要です。キーはこの端末内にのみ保存されます。</p>
        <div className="form">
          <label>Finnhub — リアルタイム株価 / WebSocket / 財務
            <input value={fk} onChange={(e) => setFk(e.target.value)} placeholder="finnhub.io で無料取得" autoComplete="off" spellCheck={false} />
          </label>
          <label>Twelve Data — 日足 OHLCV
            <input value={tk} onChange={(e) => setTk(e.target.value)} placeholder="twelvedata.com で無料取得" autoComplete="off" spellCheck={false} />
          </label>
          <button className="btn-pri" onClick={save} disabled={busy || !fk || !tk}>{busy ? '接続テスト中…' : '保存して接続テスト'}</button>
          {test.length > 0 && <ul className="checks">{test.map((t) => <li key={t}><span>{t}</span></li>)}</ul>}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={s.demoMode} onChange={(e) => { actions.updateSettings({ demoMode: e.target.checked }); resetData(); }} />
          <span>デモモード (架空データ。売買判断に使用不可)</span>
        </label>
      </Card>

      <Card title="判定ロジック">
        <div className="form">
          <label>テクニカル比重 <b className="mono">{s.techWeight}%</b> / ファンダ {100 - s.techWeight}%
            <input type="range" min={0} max={100} step={5} value={s.techWeight} onChange={num('techWeight')} />
          </label>
          <label>損切り幅 (ATR 倍率) <b className="mono">{s.atrStopMult}×</b>
            <input type="range" min={1} max={4} step={0.5} value={s.atrStopMult} onChange={num('atrStopMult')} />
          </label>
          <div className="grid2">
            <label>運用資産 ($)<input inputMode="decimal" value={s.accountSize} onChange={num('accountSize')} /></label>
            <label>1回の許容損失 (%)<input inputMode="decimal" value={s.riskPerTradePct} onChange={num('riskPerTradePct')} /></label>
          </div>
        </div>
      </Card>

      <Card title="判定ルール">
        <ul className="notes">
          <li>総合スコア = テクニカル × 比重 + ファンダ × (1 − 比重)</li>
          <li>72↑ 強い買い / 58–71 買い / 43–57 中立 / 29–42 売り / 28↓ 強い売り</li>
          <li>株価 15 分以上未更新・日足欠損・ソース間乖離 &gt;1% → <b>判定保留</b></li>
          <li>決算 7 日以内は強シグナルを 1 段階抑制</li>
          <li>新規買いは 200 日線より上のみ。損切り = 2×ATR or 20 日安値</li>
          <li>保有はシャンデリア・ストップ (22 日高値 − 3×ATR) で利益を保全</li>
        </ul>
      </Card>

      <Card title="バックアップ">
        <div className="form">
          <textarea value={io} onChange={(e) => setIo(e.target.value)} rows={4} placeholder="JSON を貼り付けてインポート" />
          <div className="form-actions">
            <button className="btn-sec" onClick={() => { setIo(actions.exportJson()); navigator.clipboard?.writeText(actions.exportJson()).catch(() => undefined); }}>エクスポート</button>
            <button className="btn-sec" onClick={() => { try { actions.importJson(io); setIo('インポート完了'); } catch (e) { setIo(`エラー: ${(e as Error).message}`); } }}>インポート</button>
          </div>
        </div>
      </Card>

      <p className="disclaimer">
        本アプリの示唆は公開データに基づく機械的なルール判定であり、投資助言ではありません。
        データ提供元の遅延・誤りの可能性があります。最終的な投資判断はご自身の責任で行ってください。
      </p>
    </div>
  );
}
