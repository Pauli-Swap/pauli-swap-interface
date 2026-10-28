import { useEffect, useState } from 'react';
import devnet from '../contracts/devnet.json';
import { toFloat } from '../lib/format';
import { currentRawPrice, humanPrice, PoolEvent, poolEvents, WindowKey, WINDOWS } from '../lib/history';
import { PoolInfo } from '../lib/registry';
import { useApp } from '../state/app';

export type PoolStats = {
  volume: number | null;
  fees: number | null;
  swaps: number;
  change: number | null;
  spark: number[];
  /// Fee APR extrapolated from the window; null when the window is shorter
  /// than an hour of chain history or there is no TVL.
  feeApr: number | null;
  windowSeconds: number;
};

const blocksFor = (seconds: number, secondsPerBlock: number) => (Number.isFinite(seconds) ? Math.ceil(seconds / secondsPerBlock) : Infinity);

function volumeInQrl(e: PoolEvent, p0: number | undefined, p1: number | undefined, d0: number, d1: number): number | null {
  if (e.kind !== 'swap') return 0;
  if (e.amount0 > 0n && p0 !== undefined) return toFloat(e.amount0, d0) * p0;
  if (e.amount1 > 0n && p1 !== undefined) return toFloat(e.amount1, d1) * p1;
  return e.amount0 > 0n || e.amount1 > 0n ? null : 0;
}

/// Volume, fees, price change and a sparkline per pool over a window.
export function usePoolStats(pools: PoolInfo[], window: WindowKey = '24h', tvl?: (p: PoolInfo) => number | null) {
  const { block, clock, priceInQrl, decimalsOf, blockTime } = useApp();
  const [stats, setStats] = useState<Map<string, PoolStats>>(new Map());
  const key = pools.map((p) => p.id).join(',');

  useEffect(() => {
    if (!block || !pools.length) return;
    let alive = true;
    const span = blocksFor(WINDOWS[window], clock.secondsPerBlock);
    const from = Math.max(devnet.startBlock, block - span);
    Promise.all(
      pools.map(async (pool) => {
        const events = await poolEvents(pool, from, block).catch(() => [] as PoolEvent[]);
        const d0 = decimalsOf(pool.token0);
        const d1 = decimalsOf(pool.token1);
        const p0 = priceInQrl(pool.token0);
        const p1 = priceInQrl(pool.token1);
        let volume: number | null = 0;
        let swaps = 0;
        for (const e of events) {
          if (e.kind !== 'swap' || (e.amount0 === 0n && e.amount1 === 0n)) continue;
          swaps++;
          const v = volumeInQrl(e, p0, p1, d0, d1);
          volume = volume === null || v === null ? null : volume + v;
        }
        const priced = events.filter((e) => e.rawPrice !== undefined).map((e) => e.rawPrice!);
        const now = currentRawPrice(pool);
        const first = priced[0];
        const seconds = blockTime(block) - blockTime(from);
        const fees = volume === null ? null : (volume * pool.fee) / 1_000_000;
        const t = tvl?.(pool);
        const feeApr = fees !== null && t && t > 0 && seconds >= 3600 ? (fees / t) * ((365 * 86400) / seconds) : null;
        return [
          pool.id,
          {
            volume,
            fees,
            swaps,
            change: first && now ? now / first - 1 : null,
            spark: [...priced, now].map((r) => humanPrice(r, d0, d1)),
            feeApr,
            windowSeconds: seconds,
          },
        ] as const;
      }),
    ).then((entries) => alive && setStats(new Map(entries)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block, key, window, clock.secondsPerBlock]);

  return stats;
}

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
type History = {
  points: { t: number; v: number }[];
  candles: Candle[];
  events: PoolEvent[];
  high: number;
  low: number;
  /// Swap volume in QRL over the window; null when a side has no QRL price.
  volume: number | null;
  loading: boolean;
};
const EMPTY: History = { points: [], candles: [], events: [], high: 0, low: 0, volume: null, loading: false };

/// Fixed-width OHLC buckets over [t0, t1], carrying the last price into
/// buckets without trades so the series has no gaps.
function bucketize(points: { t: number; v: number }[], swaps: { t: number; q: number | null }[], t0: number, t1: number, count = 48): Candle[] {
  if (points.length < 2 || t1 <= t0) return [];
  const width = (t1 - t0) / count;
  const out: Candle[] = [];
  let i = 0;
  let last = points[0].v;
  for (let b = 0; b < count; b++) {
    const start = t0 + b * width;
    const end = start + width;
    const c: Candle = { t: start, o: last, h: last, l: last, c: last, v: 0 };
    while (i < points.length && points[i].t < end) {
      const v = points[i].v;
      if (points[i].t >= start) {
        c.h = Math.max(c.h, v);
        c.l = Math.min(c.l, v);
        c.c = v;
      }
      last = v;
      i++;
    }
    c.c = last;
    c.h = Math.max(c.h, c.c);
    c.l = Math.min(c.l, c.c);
    for (const s of swaps) if (s.t >= start && s.t < end && s.q) c.v += s.q;
    out.push(c);
  }
  return out;
}

/// Price points of `pool` over a window, as the price of `base` in the other
/// token, OHLC + volume buckets for the chart, and the raw events for the
/// activity list.
export function usePoolHistory(pool: PoolInfo | null | undefined, base: string | null | undefined, window: WindowKey) {
  const { block, clock, decimalsOf, blockTime, priceInQrl } = useApp();
  const [data, setData] = useState<History>({ ...EMPTY, loading: true });

  useEffect(() => {
    if (!pool || !block) {
      setData(EMPTY);
      return;
    }
    let alive = true;
    const span = blocksFor(WINDOWS[window], clock.secondsPerBlock);
    const from = Math.max(devnet.startBlock, block - span);
    const d0 = decimalsOf(pool.token0);
    const d1 = decimalsOf(pool.token1);
    const baseIs0 = !base || base.toLowerCase() === pool.token0.toLowerCase();
    const orient = (raw: number) => {
      const p = humanPrice(raw, d0, d1);
      return baseIs0 ? p : p > 0 ? 1 / p : 0;
    };
    poolEvents(pool, from, block)
      .then((events) => {
        if (!alive) return;
        const priced = events.filter((e) => e.rawPrice !== undefined);
        const points = priced.map((e) => ({ t: blockTime(e.block), v: orient(e.rawPrice!) }));
        const now = currentRawPrice(pool);
        if (now) {
          if (points.length) points.unshift({ t: Math.min(points[0].t, blockTime(from)), v: points[0].v });
          points.push({ t: blockTime(block), v: orient(now) });
        }
        const p0 = priceInQrl(pool.token0);
        const p1 = priceInQrl(pool.token1);
        const swaps = events
          .filter((e) => e.kind === 'swap' && (e.amount0 !== 0n || e.amount1 !== 0n))
          .map((e) => ({ t: blockTime(e.block), q: volumeInQrl(e, p0, p1, d0, d1) }));
        const volume = swaps.reduce<number | null>((sum, x) => (sum === null || x.q === null ? null : sum + x.q), 0);
        const vs = points.map((x) => x.v);
        const t0 = points.length ? points[0].t : 0;
        const t1 = points.length ? points[points.length - 1].t : 0;
        setData({
          points,
          candles: bucketize(points, swaps, t0, t1),
          events,
          high: vs.length ? Math.max(...vs) : 0,
          low: vs.length ? Math.min(...vs) : 0,
          volume,
          loading: false,
        });
      })
      .catch(() => alive && setData((d) => ({ ...d, loading: false })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool?.id, pool?.sqrtPriceX96, pool?.reserve0, base, window, block]);

  return data;
}
