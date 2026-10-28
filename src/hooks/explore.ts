import { useCallback, useEffect, useMemo, useState } from 'react';
import { ADDRESSES } from '../config';
import devnet from '../contracts/devnet.json';
import { ABI, sameAddress, token as tokenContract } from '../lib/chain';
import { toFloat } from '../lib/format';
import { currentRawPrice, humanPrice, PoolEvent, poolEvents, txSender, WINDOWS, WindowKey } from '../lib/history';
import { gql, indexerBlock } from '../lib/indexer';
import { getEvents } from '../lib/logs';
import { PoolInfo } from '../lib/registry';
import { Token, wrappedAddress } from '../lib/tokens';
import { useApp } from '../state/app';

export const DAY = 86400;

export type TxRow = { pool: PoolInfo; e: PoolEvent; t: number };
/// Rows that moved tokens (everything except price-only Sync rows).
export const isFlow = (r: TxRow) => r.e.amount0 !== 0n || r.e.amount1 !== 0n;

/// Every Swap / Mint / Burn of `pools` from `seconds` ago (clamped to the
/// deployment block), newest first. poolEvents caches per pool, so pages that
/// share pools share the fetch.
export function usePoolEvents(pools: PoolInfo[], seconds = 7 * DAY) {
  const { block, clock, blockTime } = useApp();
  const [rows, setRows] = useState<TxRow[] | null>(null);
  const key = pools.map((p) => p.id).join(',');
  useEffect(() => {
    if (!block || !pools.length) {
      if (block && !pools.length) setRows([]);
      return;
    }
    let alive = true;
    const span = Number.isFinite(seconds) ? Math.ceil(seconds / clock.secondsPerBlock) : Infinity;
    const from = Math.max(devnet.startBlock, block - span);
    Promise.all(pools.map((pool) => poolEvents(pool, from, block).then((list) => list.map((e) => ({ pool, e, t: blockTime(e.block) }))).catch(() => [] as TxRow[]))).then(
      (lists) => {
        if (!alive) return;
        // Sync-only V2 rows (no amounts) stay: they carry the price. Tables drop them via `isFlow`.
        const all = lists.flat();
        all.sort((a, b) => b.e.block - a.e.block || b.e.logIndex - a.e.logIndex);
        setRows(all);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, block, seconds, clock.secondsPerBlock]);
  return rows;
}

/// Pricing helpers bound to the live QRL price map.
export function useValuation() {
  const { priceInQrl, decimalsOf } = useApp();
  const amountQrl = useCallback(
    (address: string, amount: bigint) => {
      const p = priceInQrl(address);
      return p === undefined ? null : toFloat(amount < 0n ? -amount : amount, decimalsOf(address)) * p;
    },
    [priceInQrl, decimalsOf],
  );
  const tvlOf = useCallback(
    (p: PoolInfo, r0 = p.reserve0, r1 = p.reserve1) => {
      const a = amountQrl(p.token0, r0);
      const b = amountQrl(p.token1, r1);
      return a === null || b === null ? null : a + b;
    },
    [amountQrl],
  );
  /// QRL value of an event: the side flowing into the pool for swaps, both sides for liquidity.
  const eventQrl = useCallback(
    (p: PoolInfo, e: PoolEvent) => {
      if (e.kind === 'swap') {
        if (e.amount0 > 0n) return amountQrl(p.token0, e.amount0);
        if (e.amount1 > 0n) return amountQrl(p.token1, e.amount1);
        return null;
      }
      const a = amountQrl(p.token0, e.amount0);
      const b = amountQrl(p.token1, e.amount1);
      return a === null || b === null ? null : a + b;
    },
    [amountQrl],
  );
  return { amountQrl, tvlOf, eventQrl };
}

/// Pool reserves stepped back through the events (newest first), so the
/// reserves at any earlier time are the current ones minus later flows.
export function reservesAt(pool: PoolInfo, rows: TxRow[], t: number): [bigint, bigint] {
  let r0 = pool.reserve0;
  let r1 = pool.reserve1;
  for (const r of rows) {
    if (r.t <= t) break;
    if (r.pool.id !== pool.id) continue;
    r0 -= r.e.amount0;
    r1 -= r.e.amount1;
  }
  return [r0 < 0n ? 0n : r0, r1 < 0n ? 0n : r1];
}

/// Whether the chain has history reaching `seconds` back, so a change over
/// that window compares against something real.
export function useCovered() {
  const { blockTime, clock } = useApp();
  return useCallback((seconds: number) => clock.latest > 0 && blockTime(devnet.startBlock) <= clock.latestTime - seconds, [blockTime, clock]);
}

export type PoolRowStats = { tvl: number | null; vol1d: number | null; vol7d: number | null; fees1d: number | null; apr: number | null };

/// TVL, volumes, fees and fee APR per pool from one event list.
export function usePoolTable(pools: PoolInfo[], rows: TxRow[] | null) {
  const { clock, blockTime } = useApp();
  const { tvlOf, eventQrl } = useValuation();
  return useMemo(() => {
    const now = clock.latestTime;
    const age = now - blockTime(devnet.startBlock);
    const out = new Map<string, PoolRowStats>();
    for (const p of pools) {
      let vol1d: number | null = 0;
      let vol7d: number | null = 0;
      for (const r of rows ?? []) {
        if (r.pool.id !== p.id || r.e.kind !== 'swap' || !isFlow(r)) continue;
        const v = eventQrl(p, r.e);
        if (r.t >= now - 7 * DAY) vol7d = vol7d === null || v === null ? null : vol7d + v;
        if (r.t >= now - DAY) vol1d = vol1d === null || v === null ? null : vol1d + v;
      }
      const tvl = tvlOf(p);
      const fees1d = vol1d === null ? null : (vol1d * p.fee) / 1_000_000;
      const secs = Math.min(DAY, age);
      const apr = fees1d !== null && tvl && tvl > 0 && secs >= 3600 ? (fees1d / tvl) * ((365 * DAY) / secs) : null;
      out.set(p.id, rows ? { tvl, vol1d, vol7d, fees1d, apr } : { tvl, vol1d: null, vol7d: null, fees1d: null, apr: null });
    }
    return out;
  }, [pools, rows, clock.latestTime, blockTime, tvlOf, eventQrl]);
}

export const poolsOf = (pools: PoolInfo[], t: Token) => pools.filter((p) => sameAddress(p.token0, wrappedAddress(t)) || sameAddress(p.token1, wrappedAddress(t)));

/// The deepest pool pairing `t` with WQRL (or, for QRL itself, the deepest
/// WQRL pool), which carries the token's price history in QRL.
export function useQrlPool(t: Token | null | undefined, pools: PoolInfo[]) {
  const { tvlOf } = useValuation();
  return useMemo(() => {
    if (!t) return null;
    const w = ADDRESSES.WQRL;
    const list = t.native || sameAddress(t.address, w) ? poolsOf(pools, t) : pools.filter((p) => poolsOf([p], t).length && (sameAddress(p.token0, w) || sameAddress(p.token1, w)));
    return [...list].sort((a, b) => (tvlOf(b) ?? 0) - (tvlOf(a) ?? 0))[0] ?? null;
  }, [t, pools, tvlOf]);
}

/// Price of `base` in the pool's other token after each priced event, plus now.
export function useBasePrice() {
  const { decimalsOf, blockTime, clock } = useApp();
  return useCallback(
    (pool: PoolInfo, base: string, rows: TxRow[], since: number) => {
      const d0 = decimalsOf(pool.token0);
      const d1 = decimalsOf(pool.token1);
      const is0 = sameAddress(pool.token0, base);
      const orient = (raw: number) => {
        const h = humanPrice(raw, d0, d1);
        return is0 ? h : h > 0 ? 1 / h : 0;
      };
      const pts = rows
        .filter((r) => r.pool.id === pool.id && r.e.rawPrice !== undefined && r.t >= since)
        .map((r) => ({ t: r.t, v: orient(r.e.rawPrice!) }))
        .reverse();
      const before = rows.find((r) => r.pool.id === pool.id && r.e.rawPrice !== undefined && r.t < since);
      const start = Math.max(since, blockTime(devnet.startBlock));
      if (before) pts.unshift({ t: start, v: orient(before.e.rawPrice!) });
      else if (pts.length) pts.unshift({ t: Math.min(start, pts[0].t), v: pts[0].v });
      const now = currentRawPrice(pool);
      if (now) pts.push({ t: clock.latestTime, v: orient(now) });
      return pts;
    },
    [decimalsOf, blockTime, clock.latestTime],
  );
}

export const WINDOW_SECONDS = (w: WindowKey) => WINDOWS[w];

/// Sum of values into `count` equal buckets over [t0, t1].
export function bucketSum(items: { t: number; v: number }[], t0: number, t1: number, count = 24) {
  if (!(t1 > t0)) return [];
  const w = (t1 - t0) / count;
  const out = Array.from({ length: count }, (_, i) => ({ t: t0 + i * w, t1: t0 + (i + 1) * w, v: 0 }));
  for (const it of items) {
    if (it.t < t0 || it.t > t1) continue;
    out[Math.min(count - 1, Math.floor((it.t - t0) / w))].v += it.v;
  }
  return out;
}

/// Wallet that sent a transaction (V2 events name the router, so the tx is the source).
export function useSender(hash: string | undefined) {
  const [from, setFrom] = useState<string | undefined>();
  useEffect(() => {
    if (!hash) return;
    let alive = true;
    txSender(hash).then((f) => alive && setFrom(f));
    return () => {
      alive = false;
    };
  }, [hash]);
  return from;
}

export type TokenFacts = { totalSupply: bigint | null; holders: number | null };

/// Total supply and holder count (accounts with a non-zero balance after
/// replaying every Transfer since deployment). Native QRL has neither here.
export function useTokenFacts(t: Token | null | undefined) {
  const { block } = useApp();
  const [facts, setFacts] = useState<TokenFacts>({ totalSupply: null, holders: null });
  const address = t && !t.native ? t.address : null;
  useEffect(() => {
    if (!address || !block) return;
    let alive = true;
    tokenContract(address)
      .methods.totalSupply()
      .call()
      .then((v: bigint) => alive && setFacts((f) => ({ ...f, totalSupply: BigInt(v) })))
      .catch(() => undefined);
    const replay = () =>
      getEvents(ABI.token as unknown[], address, ['Transfer'], devnet.startBlock, block)
        .then((events) => {
          const bal = new Map<string, bigint>();
          for (const e of events) {
            const v = e.returnValues;
            const from = String(v.from).toLowerCase();
            const to = String(v.to).toLowerCase();
            const amount = BigInt(v.value ?? v.amount ?? v[2] ?? 0);
            bal.set(from, (bal.get(from) ?? 0n) - amount);
            bal.set(to, (bal.get(to) ?? 0n) + amount);
          }
          const holders = [...bal].filter(([a, b]) => b > 0n && !/^q0+$/.test(a)).length;
          if (alive) setFacts((f) => ({ ...f, holders: events.length ? holders : f.holders }));
        })
        .catch(() => undefined);
    // The indexer derives holders from every Transfer / Deposit / Withdrawal
    // since genesis; the replay is the fallback.
    indexerBlock(block)
      .then((indexed) =>
        indexed === null
          ? null
          : gql<{ token: { holderCount: number } | null }>('query($id: ID!) { token(id: $id) { holderCount } }', { id: address }).then((r) => r.token?.holderCount ?? null),
      )
      .catch(() => null)
      .then((holders) => {
        if (holders === null) return replay();
        if (alive) setFacts((f) => ({ ...f, holders }));
      });
    return () => {
      alive = false;
    };
    // Holders move slowly; refresh every ~20 blocks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, Math.floor(block / 20)]);
  return facts;
}
