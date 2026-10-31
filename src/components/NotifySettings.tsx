import { useState } from 'react';
import { actions, useApp } from '../state/store';
import { permission, requestPermission, showAlert } from '../state/notify';
import { buildNotifyConfig } from '../lib/notifyConfig';
import { Card } from './ui';

const PERM_LABEL: Record<string, string> = {
  granted: '許可済み', denied: 'ブロック中 (端末の設定で許可してください)', default: '未許可', unsupported: '非対応 (iPhone はホーム画面に追加して開いてください)',
};

export function NotifySettings() {
  const s = useApp((x) => x.settings);
  const holdings = useApp((x) => x.holdings);
  const watch = useApp((x) => x.watchlist);
  const [perm, setPerm] = useState(permission());
  const [copied, setCopied] = useState('');

  // 許可ダイアログの結果を待たずに切替 (不許可でも画面内トーストは表示される)
  const toggle = (on: boolean) => {
    actions.updateSettings({ notifyInApp: on });
    if (on) requestPermission().then(setPerm);
  };

  const copyConfig = async () => {
    const json = buildNotifyConfig(holdings, watch, s);
    try {
      await navigator.clipboard.writeText(json);
      setCopied('コピーしました。GitHub の Secret「NOTIFY_CONFIG」に貼り付けてください');
    } catch {
      setCopied(json);
    }
  };

  return (
    <Card title="プッシュ通知">
      <div className="notify-layer">
        <div className="nl-h"><b>① アプリ内通知</b><small>アプリを開いている間</small></div>
        <label className="toggle">
          <input type="checkbox" checked={s.notifyInApp} onChange={(e) => toggle(e.target.checked)} />
          <span>シグナル変化を通知する</span>
        </label>
        <small className="muted">端末の通知: {PERM_LABEL[perm] ?? perm}</small>
        <button className="btn-sec" onClick={() => showAlert({ title: '✅ SIGNAL/US テスト通知', body: '通知は正常に動作しています', priority: 'default' })}>テスト通知</button>
      </div>

      <div className="notify-layer">
        <div className="nl-h"><b>② サーバー通知</b><small>アプリを閉じていても届く</small></div>
        <ol className="steps">
          <li>スマホに <a href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy</a> アプリを入れ、推測されにくいトピック名 (例: <code>signal-us-8f3k2q</code>) を購読</li>
          <li>GitHub の Settings → Secrets and variables → Actions に登録:<br />
            <code>FINNHUB_KEY</code> <code>TWELVEDATA_KEY</code> <code>NTFY_TOPIC</code> <code>NOTIFY_CONFIG</code></li>
          <li>下のボタンでコピーした内容を <code>NOTIFY_CONFIG</code> に貼り付け</li>
          <li>Actions →「Signal notifications」→ Run workflow (test) で受信を確認</li>
        </ol>
        <button className="btn-pri" onClick={copyConfig}>通知用設定をコピー ({holdings.length + watch.length}銘柄)</button>
        {copied && <small className="muted copied">{copied}</small>}
        <small className="muted">保有・ウォッチを変更したら再コピーして Secret を更新してください。API キーは含まれません。</small>
      </div>

      <ul className="notes">
        <li>通知対象: 損切り到達・売却推奨 (緊急) / 利確・一部売却 / 買い増し候補 / 検討株の買いシグナル</li>
        <li>状態が変わったときに 1 回。損切り・売却は継続中なら 1 日 1 回再通知</li>
        <li>データ品質 NG (判定保留) の間は売買通知を止めます (損切り到達のみ例外)</li>
        <li>サーバー通知は取引時間中 15 分間隔 (GitHub の混雑で数分遅れることがあります)</li>
      </ul>
    </Card>
  );
}
