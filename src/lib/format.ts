export const usd = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;

export const pct = (n: number | null | undefined, d = 2, sign = true) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : `${sign && n > 0 ? '+' : ''}${n.toFixed(d)}%`;

export const signed = (n: number, d = 2) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${usd(Math.abs(n), d)}`;

export const num = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(d);

export const bigUsd = (millions: number | null) => {
  if (millions === null) return '—';
  if (millions >= 1e6) return `$${(millions / 1e6).toFixed(2)}T`;
  if (millions >= 1e3) return `$${(millions / 1e3).toFixed(1)}B`;
  return `$${millions.toFixed(0)}M`;
};

export const tone = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

export function ago(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  return `${Math.floor(s / 86400)}日前`;
}
