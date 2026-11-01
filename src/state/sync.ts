// ===== 端末間同期コントローラ =====
// 変更は 1.5 秒後に送信、起動時・復帰時・60 秒ごとに受信。新しい方 (updatedAt) を採用する。

import { useSyncExternalStore } from 'react';
import { createSync, decodeSyncCode, encodeSyncCode, pullSync, pushSync } from '../lib/sync';
import type { SyncCode, SyncPayload } from '../lib/sync';
import { cacheClear } from '../lib/providers/http';
import { applyRemote, getState, subscribeApp } from './store';
import { resetData } from './data';

const CFG_KEY = 'usx-sync';

export interface SyncStatus {
  enabled: boolean;
  busy: boolean;
  lastOk: number | null;
  error: string | null;
  /** 直前の同期で別端末の内容を取り込んだ */
  pulledAt: number | null;
}

let code: SyncCode | null = loadCode();
let status: SyncStatus = { enabled: !!code, busy: false, lastOk: null, error: null, pulledAt: null };
const ls = new Set<() => void>();
const setStatus = (p: Partial<SyncStatus>) => { status = { ...status, ...p }; ls.forEach((l) => l()); };

function loadCode(): SyncCode | null {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    return raw ? (JSON.parse(raw) as SyncCode) : null;
  } catch { return null; }
}
function saveCode(c: SyncCode | null) {
  try { if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(CFG_KEY); } catch { /* noop */ }
}

function payload(): SyncPayload {
  const s = getState();
  const { notifyInApp: _device, ...settings } = s.settings;
  return { v: 1, updatedAt: s.updatedAt || Date.now(), holdings: s.holdings, watchlist: s.watchlist, settings };
}

function apply(remote: SyncPayload) {
  const before = getState().settings;
  applyRemote(remote);
  const after = getState().settings;
  // データソースが変わったら取得し直す
  if (before.finnhubKey !== after.finnhubKey || before.twelveDataKey !== after.twelveDataKey || before.demoMode !== after.demoMode) {
    cacheClear();
    resetData();
  }
}

let running: Promise<void> | null = null;

/** 受信 → 新しい方を採用 (ローカルが新しければ送信) */
export function syncNow(): Promise<void> {
  if (!code) return Promise.resolve();
  if (running) return running;
  const c = code;
  running = (async () => {
    setStatus({ busy: true });
    try {
      const remote = await pullSync(c);
      const local = getState().updatedAt;
      if (remote.updatedAt > local) {
        apply(remote);
        setStatus({ pulledAt: Date.now() });
      } else if (local > remote.updatedAt) {
        await pushSync(c, payload());
      }
      setStatus({ busy: false, lastOk: Date.now(), error: null });
    } catch (e) {
      setStatus({ busy: false, error: (e as Error).message });
    } finally {
      running = null;
    }
  })();
  return running;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSeen = getState().updatedAt;
let started = false;

/** アプリ起動時に 1 回呼ぶ */
export function startSync() {
  if (started) return;
  started = true;
  subscribeApp(() => {
    const u = getState().updatedAt;
    if (u === lastSeen) return;
    lastSeen = u;
    if (!code) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { syncNow(); }, 1500);
  });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  syncNow();
}

/** この端末のデータで同期を開始 (新しい Gist を作成) */
export async function enableWithToken(token: string) {
  setStatus({ busy: true, error: null });
  try {
    const p = payload();
    if (!getState().updatedAt) p.updatedAt = Date.now();
    code = await createSync(token.trim(), p);
    saveCode(code);
    setStatus({ enabled: true, busy: false, lastOk: Date.now() });
  } catch (e) {
    setStatus({ busy: false, error: (e as Error).message });
    throw e;
  }
}

/** 他の端末の同期コードで接続 (同期先の内容でこの端末を上書き) */
export async function enableWithCode(text: string) {
  setStatus({ busy: true, error: null });
  try {
    const c = decodeSyncCode(text);
    const remote = await pullSync(c);
    code = c;
    saveCode(c);
    apply(remote);
    setStatus({ enabled: true, busy: false, lastOk: Date.now(), pulledAt: Date.now() });
  } catch (e) {
    setStatus({ busy: false, error: (e as Error).message });
    throw e;
  }
}

export function disableSync() {
  code = null;
  saveCode(null);
  setStatus({ enabled: false, error: null, lastOk: null, pulledAt: null });
}

export function currentSyncCode(): string | null {
  return code ? encodeSyncCode(code) : null;
}

export function useSyncStatus() {
  return useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => status);
}
