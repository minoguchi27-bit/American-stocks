// ===== 端末間同期 (GitHub Gist + エンドツーエンド暗号化) =====
// 保存先は非公開 Gist。中身は同期コード内のランダム鍵で AES-GCM 暗号化するため、
// Gist の URL が漏れても内容は読めない。アプリと通知スクリプトで共用。

import type { Holding, Settings, WatchItem } from './types';

export const SYNC_FILE = 'signal-us-sync.json';
const API = 'https://api.github.com';

/** 同期する内容 (端末ごとの設定 notifyInApp は除く) */
export interface SyncPayload {
  v: 1;
  updatedAt: number;
  holdings: Holding[];
  watchlist: WatchItem[];
  settings: Omit<Settings, 'notifyInApp'>;
}

/** 同期コード = GitHub トークン + Gist ID + 暗号鍵 */
export interface SyncCode {
  token: string;
  gistId: string;
  key: string; // base64 AES-256 鍵
}

interface Envelope { v: 1; alg: 'AES-GCM'; iv: string; ct: string }

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const PREFIX = 'SIGUS1.';

export function encodeSyncCode(c: SyncCode): string {
  return PREFIX + btoa(JSON.stringify({ t: c.token, g: c.gistId, k: c.key }));
}

export function decodeSyncCode(code: string): SyncCode {
  const s = code.trim();
  if (!s.startsWith(PREFIX)) throw new Error('同期コードの形式が正しくありません');
  try {
    const o = JSON.parse(atob(s.slice(PREFIX.length))) as { t?: string; g?: string; k?: string };
    if (!o.t || !o.g || !o.k) throw new Error();
    return { token: o.t, gistId: o.g, key: o.k };
  } catch {
    throw new Error('同期コードが壊れています。全体をコピーし直してください');
  }
}

export function newKey(): string {
  return b64(crypto.getRandomValues(new Uint8Array(32)));
}

async function aesKey(key: string) {
  return crypto.subtle.importKey('raw', unb64(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(payload: SyncPayload, key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key), new TextEncoder().encode(JSON.stringify(payload)));
  const env: Envelope = { v: 1, alg: 'AES-GCM', iv: b64(iv), ct: b64(ct) };
  return JSON.stringify(env);
}

export async function decrypt(content: string, key: string): Promise<SyncPayload> {
  let env: Envelope;
  try { env = JSON.parse(content) as Envelope; } catch { throw new Error('同期データが壊れています'); }
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, await aesKey(key), unb64(env.ct));
    return JSON.parse(new TextDecoder().decode(pt)) as SyncPayload;
  } catch {
    throw new Error('同期データを復号できません (同期コードが違う可能性)');
  }
}

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, {
    ...init,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
  });
  if (res.status === 401) throw new Error('GitHub トークンが無効か期限切れです');
  if (res.status === 403) throw new Error('トークンに Gist の権限がありません (Gists: Read and write)');
  if (res.status === 404) throw new Error('同期先の Gist が見つかりません (削除された可能性)');
  if (!res.ok) throw new Error(`GitHub API エラー HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface GistResp { id: string; files: Record<string, { content?: string; truncated?: boolean; raw_url?: string }> }

/** 新しい非公開 Gist を作成して同期コードを返す */
export async function createSync(token: string, payload: SyncPayload): Promise<SyncCode> {
  const key = newKey();
  const g = await gh<GistResp>(token, '/gists', {
    method: 'POST',
    body: JSON.stringify({ description: 'SIGNAL/US sync (encrypted)', public: false, files: { [SYNC_FILE]: { content: await encrypt(payload, key) } } }),
  });
  return { token, gistId: g.id, key };
}

export async function pullSync(c: SyncCode): Promise<SyncPayload> {
  const g = await gh<GistResp>(c.token, `/gists/${c.gistId}`);
  const f = g.files[SYNC_FILE];
  if (!f?.content) throw new Error('同期データがありません');
  return decrypt(f.content, c.key);
}

export async function pushSync(c: SyncCode, payload: SyncPayload): Promise<void> {
  await gh<GistResp>(c.token, `/gists/${c.gistId}`, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [SYNC_FILE]: { content: await encrypt(payload, c.key) } } }),
  });
}
