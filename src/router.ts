import { useSyncExternalStore } from 'react';

const sub = (l: () => void) => { window.addEventListener('hashchange', l); return () => window.removeEventListener('hashchange', l); };

export function useRoute(): string {
  return useSyncExternalStore(sub, () => window.location.hash.replace(/^#/, '') || '/');
}

export function go(path: string) {
  window.location.hash = path;
}
