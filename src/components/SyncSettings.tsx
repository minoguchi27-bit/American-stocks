import { useState } from 'react';
import { currentSyncCode, disableSync, enableWithCode, enableWithToken, syncNow, useSyncStatus } from '../state/sync';
import { useNow } from '../state/data';
import { ago } from '../lib/format';
import { Card } from './ui';

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=SIGNAL-US%20sync';

export function SyncSettings() {
  const st = useSyncStatus();
  const now = useNow(5000);
  const [mode, setMode] = useState<'new' | 'join'>('new');
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState('');

  const copyCode = async () => {
    const c = currentSyncCode();
    if (!c) return;
    try { await navigator.clipboard.writeText(c); setMsg('同期コードをコピーしました。もう一方の端末で「同期コードで接続」に貼り付けてください'); }
    catch { setMsg(c); }
  };

  if (st.enabled) {
    return (
      <Card title="端末間同期" right={<span className={`chip ${st.error ? 'bad' : 'ok'}`}>{st.error ? 'エラー' : st.busy ? '同期中' : '同期ON'}</span>}>
        <div className="form">
          <small className="muted">
            {st.lastOk ? `最終同期 ${ago(st.lastOk, now)}` : '未同期'}
            {st.pulledAt && now - st.pulledAt < 60_000 ? ' · 別端末の変更を反映しました' : ''}
          </small>
          {st.error && <div className="err">{st.error}</div>}
          <div className="form-actions">
            <button className="btn-sec" onClick={() => syncNow()} disabled={st.busy}>今すぐ同期</button>
            <button className="btn-sec" onClick={copyCode}>同期コードをコピー</button>
          </div>
          {msg && <small className="muted copied">{msg}</small>}
          <ul className="notes">
            <li>保有・ウォッチ・API キー・判定設定を同期します (通知のオン/オフは端末ごと)</li>
            <li>データは暗号化して GitHub の非公開 Gist に保存。同期コードがないと読めません</li>
            <li>サーバー通知には同期コードを Secret「SYNC_CODE」に登録すると、銘柄の変更が自動で反映されます</li>
            <li>同期コードはパスワードと同じです。他人に渡さないでください</li>
          </ul>
          <button className="link" onClick={() => { if (confirm('この端末の同期を解除しますか？ (データはこの端末に残ります)')) disableSync(); }}>この端末の同期を解除</button>
        </div>
      </Card>
    );
  }

  const submit = async () => {
    setMsg('');
    try {
      if (mode === 'new') {
        await enableWithToken(input);
        setMsg('同期を開始しました。「同期コードをコピー」で他の端末に渡してください');
      } else {
        if (!confirm('この端末のデータ (保有・ウォッチ・API キー) を同期先の内容で置き換えます。よろしいですか？')) return;
        await enableWithCode(input);
      }
      setInput('');
    } catch { /* エラーは status に表示 */ }
  };

  return (
    <Card title="端末間同期">
      <p className="muted small">iPhone・iPad など複数の端末で、保有銘柄・ウォッチ・API キーを自動で揃えます。</p>
      <div className="seg seg-full">
        <button className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')}>最初の端末で開始</button>
        <button className={mode === 'join' ? 'on' : ''} onClick={() => setMode('join')}>同期コードで接続</button>
      </div>
      <div className="form" style={{ marginTop: 12 }}>
        {mode === 'new' ? (
          <>
            <ol className="steps">
              <li>データが揃っている端末で行います</li>
              <li><a href={TOKEN_URL} target="_blank" rel="noreferrer">GitHub のトークン作成ページ</a>を開き、Expiration を選んで「Generate token」(権限は gist のみ)</li>
              <li>表示された <code>ghp_…</code> を下に貼り付け</li>
            </ol>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="ghp_xxxxxxxx" autoComplete="off" spellCheck={false} />
          </>
        ) : (
          <>
            <ol className="steps">
              <li>同期済みの端末で 設定 → 端末間同期 →「同期コードをコピー」</li>
              <li>AirDrop やメモでこの端末に送り、下に貼り付け</li>
            </ol>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="SIGUS1.xxxxxxxx" autoComplete="off" spellCheck={false} />
          </>
        )}
        <button className="btn-pri" onClick={submit} disabled={st.busy || !input.trim()}>{st.busy ? '処理中…' : mode === 'new' ? '同期を開始' : '接続する'}</button>
        {st.error && <div className="err">{st.error}</div>}
        {msg && <small className="muted copied">{msg}</small>}
      </div>
    </Card>
  );
}
