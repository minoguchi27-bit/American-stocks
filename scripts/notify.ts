// ===== サーバー側シグナル監視 → プッシュ通知 (ntfy) =====
// GitHub Actions から定期実行。アプリを閉じていても売買シグナルを通知する。
//
// 環境変数:
//   FINNHUB_KEY, TWELVEDATA_KEY   データ API キー
//   SYNC_CODE                     アプリ「設定 → 端末間同期」の同期コード (推奨: 銘柄・キーの変更が自動反映)
//   NOTIFY_CONFIG                 SYNC_CODE を使わない場合: アプリでコピーした JSON (保有・ウォッチ・判定パラメータ)
//   NTFY_TOPIC                    ntfy のトピック名 (推測されにくい文字列)
//   NTFY_SERVER  (任意)           既定 https://ntfy.sh
//   NTFY_TOKEN   (任意)           アクセストークン (保護トピック用)
//   APP_URL      (任意)           通知タップ時に開くアプリの URL
//   STATE_FILE   (任意)           重複通知防止の状態ファイル。既定 .notify-state/state.json
// 引数:
//   --dry    通知を送らずに内容を表示
//   --test   テスト通知を 1 件送って終了
//   --force  取引時間外でも実行

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Candle, Fundamentals, Holding, WatchItem } from '../src/lib/types';
import type { EngineSettings } from '../src/lib/engine';
import { analyzeSymbol } from '../src/lib/engine';
import { alertFor, nextMemo, shouldNotify } from '../src/lib/alerts';
import type { Alert, AlertMemo, AlertPriority } from '../src/lib/alerts';
import { marketSession, nyParts } from '../src/lib/market';
import { fhFundamentals, fhQuote } from '../src/lib/providers/finnhub';
import { tdDaily } from '../src/lib/providers/twelvedata';
import { parseNotifyConfig } from '../src/lib/notifyConfig';
import type { NotifyConfig } from '../src/lib/notifyConfig';
import { decodeSyncCode, pullSync } from '../src/lib/sync';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const env = (k: string, required = true) => {
  const v = process.env[k]?.trim();
  if (!v && required) throw new Error(`環境変数 ${k} が未設定です`);
  return v ?? '';
};

interface State {
  memo: Record<string, AlertMemo>;
  candles: Record<string, { at: number; data: Candle[] }>;
  fund: Record<string, { at: number; data: Fundamentals }>;
}

const STATE_FILE = process.env.STATE_FILE || '.notify-state/state.json';
const CANDLE_TTL = 60 * 60_000; // 日足は 1 時間ごとに再取得 (当日足は気配で更新)
const FUND_TTL = 12 * 3600_000;

function loadState(): State {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Partial<State>;
    return { memo: s.memo ?? {}, candles: s.candles ?? {}, fund: s.fund ?? {} };
  } catch {
    return { memo: {}, candles: {}, fund: {} };
  }
}

function saveState(s: State) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s));
}

const PRIORITY: Record<AlertPriority, number> = { urgent: 5, high: 4, default: 3 };

async function send(a: Pick<Alert, 'title' | 'body' | 'priority'> & { symbol?: string }) {
  const server = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
  const appUrl = process.env.APP_URL || defaultAppUrl();
  const payload = {
    topic: env('NTFY_TOPIC'),
    title: a.title,
    message: a.body,
    priority: PRIORITY[a.priority],
    ...(appUrl ? { click: a.symbol ? `${appUrl}#/s/${a.symbol}` : appUrl } : {}),
  };
  if (DRY) { console.log('[dry-run]', JSON.stringify(payload, null, 2)); return; }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  const res = await fetch(server, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`ntfy 送信失敗: HTTP ${res.status} ${await res.text()}`);
}

function defaultAppUrl() {
  const repo = process.env.GITHUB_REPOSITORY; // owner/name
  if (!repo) return '';
  const [owner, name] = repo.split('/');
  return `https://${owner.toLowerCase()}.github.io/${name}/`;
}

/** 設定の取得: 同期コードがあれば同期先 (暗号化 Gist) から、なければ個別の Secret から */
async function loadConfig(): Promise<{ cfg: NotifyConfig; fk: string; tk: string }> {
  if (process.env.SYNC_CODE?.trim()) {
    const p = await pullSync(decodeSyncCode(env('SYNC_CODE')));
    const fk = process.env.FINNHUB_KEY?.trim() || p.settings.finnhubKey;
    const tk = process.env.TWELVEDATA_KEY?.trim() || p.settings.twelveDataKey;
    if (!fk || !tk) throw new Error('API キーがありません (アプリで設定するか FINNHUB_KEY / TWELVEDATA_KEY を登録)');
    const cfg = parseNotifyConfig(JSON.stringify({
      v: 1, holdings: p.holdings, watchlist: p.watchlist,
      settings: { techWeight: p.settings.techWeight, atrStopMult: p.settings.atrStopMult, accountSize: p.settings.accountSize, riskPerTradePct: p.settings.riskPerTradePct },
    }));
    console.log(`同期先から設定を読み込み (更新 ${new Date(p.updatedAt).toISOString()})`);
    return { cfg, fk, tk };
  }
  return { cfg: parseNotifyConfig(env('NOTIFY_CONFIG')), fk: env('FINNHUB_KEY'), tk: env('TWELVEDATA_KEY') };
}

async function main() {
  if (args.has('--test')) {
    await send({ title: '✅ SIGNAL/US テスト通知', body: '通知の設定は正常です。取引時間中のシグナルをお知らせします。', priority: 'default' });
    console.log('テスト通知を送信しました');
    return;
  }

  // Secret 未登録 (サーバー通知を使わない) 場合は失敗させずに終了
  const has = (k: string) => !!process.env[k]?.trim();
  const missing = has('SYNC_CODE')
    ? ['NTFY_TOPIC'].filter((k) => !has(k))
    : ['NOTIFY_CONFIG', 'NTFY_TOPIC', 'FINNHUB_KEY', 'TWELVEDATA_KEY'].filter((k) => !has(k));
  if (missing.length) {
    console.log(`未設定のため通知をスキップ: ${missing.join(', ')}`);
    return;
  }

  const now = Date.now();
  const session = marketSession(now);
  const ny = nyParts(now);
  // 取引時間中 + 引け後 30 分 (終値ベースの最終判定) のみ実行
  const inWindow = session === 'regular' || (session === 'post' && ny.minutes < 16 * 60 + 30);
  if (!inWindow && !args.has('--force')) {
    console.log(`取引時間外 (${session}, NY ${ny.date} ${Math.floor(ny.minutes / 60)}:${String(ny.minutes % 60).padStart(2, '0')}) — スキップ`);
    return;
  }

  const { cfg, fk, tk } = await loadConfig();
  const settings: EngineSettings = cfg.settings;
  const state = loadState();

  const targets: { symbol: string; holding?: Holding }[] = [
    ...cfg.holdings.map((h) => ({ symbol: h.symbol, holding: h })),
    ...cfg.watchlist.filter((w: WatchItem) => !cfg.holdings.some((h) => h.symbol === w.symbol)).map((w) => ({ symbol: w.symbol })),
  ];
  console.log(`対象 ${targets.length} 銘柄 / session=${session}`);

  let sent = 0;
  const failures: string[] = [];
  for (const t of targets) {
    try {
      const c = state.candles[t.symbol];
      if (!c || now - c.at > CANDLE_TTL) {
        const r = await tdDaily(t.symbol, tk, true);
        state.candles[t.symbol] = { at: now, data: r.candles };
      }
      const f = state.fund[t.symbol];
      if (!f || now - f.at > FUND_TTL) {
        state.fund[t.symbol] = { at: now, data: await fhFundamentals(t.symbol, fk, true) };
      }
      const quote = await fhQuote(t.symbol, fk);
      const r = analyzeSymbol({
        candles: state.candles[t.symbol].data, quote, fund: state.fund[t.symbol].data, holding: t.holding, settings, now,
      });
      const key = t.holding ? `h:${t.holding.id}` : `w:${t.symbol}`;
      const a = alertFor(t.symbol, r, quote.price);
      const prev = state.memo[key];
      const go = shouldNotify(a, prev, ny.date);
      console.log(`${t.symbol.padEnd(6)} ${String(r.verdict.composite ?? '--').padStart(3)} ${r.verdict.level.padEnd(11)} ${a.state}${go ? '  → 通知' : ''}${r.integrity.blockers.length ? `  [保留: ${r.integrity.blockers.join(' / ')}]` : ''}`);
      if (go) { await send(a); sent++; }
      state.memo[key] = nextMemo(a, prev, ny.date, go);
    } catch (e) {
      failures.push(`${t.symbol}: ${(e as Error).message}`);
      console.error(`${t.symbol}: ${(e as Error).message}`);
    }
  }
  // 監視対象から外れた銘柄のキャッシュを掃除
  const keep = new Set(targets.map((t) => t.symbol));
  for (const k of Object.keys(state.candles)) if (!keep.has(k)) delete state.candles[k];
  for (const k of Object.keys(state.fund)) if (!keep.has(k)) delete state.fund[k];
  if (!DRY) saveState(state);
  console.log(`通知 ${sent} 件 / 失敗 ${failures.length} 件`);
  // 全銘柄が失敗した場合 (キー無効など) はジョブを失敗させて気付けるようにする
  if (targets.length && failures.length === targets.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
