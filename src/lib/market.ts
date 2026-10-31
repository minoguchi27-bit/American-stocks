// ===== NYSE 取引時間判定 (America/New_York) =====

export type Session = 'pre' | 'regular' | 'post' | 'closed';

// NYSE 休場日 (公式カレンダー)
const HOLIDAYS = new Set([
  // 2025
  '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26',
  '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18',
  '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

// 13:00 短縮取引日
const EARLY_CLOSE = new Set(['2025-07-03', '2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24', '2027-11-26']);

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
});

export function nyParts(ts = Date.now()) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: hour * 60 + Number(p.minute),
    weekday: p.weekday as string,
  };
}

export function isTradingDay(date: string, weekday?: string): boolean {
  const wd = weekday ?? new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  if (wd === 'Sat' || wd === 'Sun') return false;
  return !HOLIDAYS.has(date);
}

export function marketSession(ts = Date.now()): Session {
  const { date, minutes, weekday } = nyParts(ts);
  if (!isTradingDay(date, weekday)) return 'closed';
  const close = EARLY_CLOSE.has(date) ? 13 * 60 : 16 * 60;
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'pre';
  if (minutes >= 9 * 60 + 30 && minutes < close) return 'regular';
  if (minutes >= close && minutes < 20 * 60) return 'post';
  return 'closed';
}

export const SESSION_LABEL: Record<Session, string> = {
  pre: 'プレマーケット',
  regular: '取引時間中',
  post: 'アフターマーケット',
  closed: '休場',
};

/** 直近の取引日 (当日含む, 9:30 前なら前営業日) */
export function lastTradingDate(ts = Date.now()): string {
  const { date, minutes, weekday } = nyParts(ts);
  if (isTradingDay(date, weekday) && minutes >= 9 * 60 + 30) return date;
  let d = new Date(date + 'T12:00:00Z');
  for (let i = 0; i < 10; i++) {
    d = new Date(d.getTime() - 86400000);
    const s = d.toISOString().slice(0, 10);
    if (isTradingDay(s)) return s;
  }
  return date;
}

/** 2 つの取引日の間の営業日数 (a < b) */
export function tradingDaysBetween(a: string, b: string): number {
  if (a >= b) return 0;
  let n = 0;
  let d = new Date(a + 'T12:00:00Z');
  const end = new Date(b + 'T12:00:00Z');
  while (d < end && n < 400) {
    d = new Date(d.getTime() + 86400000);
    if (isTradingDay(d.toISOString().slice(0, 10))) n++;
  }
  return n;
}
