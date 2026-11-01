import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSync, decodeSyncCode, decrypt, encodeSyncCode, encrypt, newKey, pullSync, pushSync } from './sync';
import type { SyncPayload } from './sync';

const payload = (n: number): SyncPayload => ({
  v: 1, updatedAt: n, watchlist: [{ symbol: 'NVDA', addedAt: '2026-01-01' }],
  holdings: [{ id: 'h1', symbol: 'AAPL', shares: n, avgCost: 190, boughtAt: '2026-03-02' }],
  settings: { finnhubKey: 'fk', twelveDataKey: 'tk', demoMode: false, techWeight: 60, atrStopMult: 2, riskPerTradePct: 1, accountSize: 10000 },
});

describe('sync crypto', () => {
  it('暗号化 → 復号で元に戻り、平文 (API キー) を含まない', async () => {
    const k = newKey();
    const ct = await encrypt(payload(1), k);
    expect(ct).not.toContain('AAPL');
    expect(ct).not.toContain('fk');
    expect(await decrypt(ct, k)).toEqual(payload(1));
  });
  it('別の鍵では復号できない', async () => {
    const ct = await encrypt(payload(1), newKey());
    await expect(decrypt(ct, newKey())).rejects.toThrow('復号');
  });
  it('同期コードの往復と不正コード', () => {
    const c = { token: 'ghp_x', gistId: 'abc', key: newKey() };
    expect(decodeSyncCode(encodeSyncCode(c))).toEqual(c);
    expect(() => decodeSyncCode('hello')).toThrow();
    expect(() => decodeSyncCode('SIGUS1.!!!')).toThrow();
  });
});

describe('gist I/O (mock)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('作成 → 取得 → 更新', async () => {
    let content = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST' || init?.method === 'PATCH') {
        content = JSON.parse(String(init.body)).files['signal-us-sync.json'].content;
      }
      expect(String(init?.headers && (init.headers as Record<string, string>).Authorization)).toBe('Bearer ghp_t');
      return new Response(JSON.stringify({ id: 'g1', files: { 'signal-us-sync.json': { content } } }), { status: 200 });
    }));
    const c = await createSync('ghp_t', payload(1));
    expect(c.gistId).toBe('g1');
    expect((await pullSync(c)).holdings[0].shares).toBe(1);
    await pushSync(c, payload(5));
    expect((await pullSync(c)).holdings[0].shares).toBe(5);
  });
  it('権限エラーを日本語で返す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(pullSync({ token: 'x', gistId: 'g', key: newKey() })).rejects.toThrow('トークン');
  });
});
