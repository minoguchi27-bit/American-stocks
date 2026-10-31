// ===== アプリ内通知 (Notification API) + 画面内トースト =====

import { useSyncExternalStore } from 'react';
import type { Alert, AlertMemo } from '../lib/alerts';

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;

export function permission(): NotificationPermission | 'unsupported' {
  return notifySupported() ? Notification.permission : 'unsupported';
}

export async function requestPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notifySupported()) return 'unsupported';
  return Notification.requestPermission();
}

/** OS 通知 (許可済みの場合) + 画面内トースト */
export async function showAlert(a: Pick<Alert, 'title' | 'body' | 'priority'> & { symbol?: string }) {
  pushToast(a);
  if (permission() !== 'granted') return;
  const url = `${location.origin}${location.pathname}${a.symbol ? `#/s/${a.symbol}` : ''}`;
  const opts: NotificationOptions & { renotify?: boolean } = {
    body: a.body,
    tag: a.symbol ? `sig-${a.symbol}` : 'sig-test',
    renotify: true,
    requireInteraction: a.priority === 'urgent',
    icon: './icon.svg',
    data: { url },
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.showNotification(a.title, opts); return; }
  } catch { /* SW 未登録時はフォールバック */ }
  try { new Notification(a.title, opts); } catch { /* iOS ではホーム画面追加時のみ */ }
}

// ---- 重複防止メモ (端末内) ----
const MEMO_KEY = 'usx-alert-memo';
export function loadMemo(): Record<string, AlertMemo> {
  try { return JSON.parse(localStorage.getItem(MEMO_KEY) || '{}') as Record<string, AlertMemo>; } catch { return {}; }
}
export function saveMemo(m: Record<string, AlertMemo>) {
  try { localStorage.setItem(MEMO_KEY, JSON.stringify(m)); } catch { /* noop */ }
}

// ---- トースト ----
export interface Toast { id: number; title: string; body: string; priority: Alert['priority']; symbol?: string }
let toasts: Toast[] = [];
let seq = 0;
const ls = new Set<() => void>();
const emit = () => ls.forEach((l) => l());

function pushToast(a: Omit<Toast, 'id'>) {
  const t = { ...a, id: ++seq };
  toasts = [...toasts, t].slice(-3);
  emit();
  setTimeout(() => dismissToast(t.id), a.priority === 'urgent' ? 20_000 : 8_000);
}
export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
export function useToasts() {
  return useSyncExternalStore((l) => { ls.add(l); return () => ls.delete(l); }, () => toasts);
}
