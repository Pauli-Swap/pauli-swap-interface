import { useEffect, useState } from 'react';
import { positionManager, sameAddress, tickLens } from '../lib/chain';
import { PoolInfo } from '../lib/registry';
import { amountsForLiquidity, MAX_UINT128, priceFromTick, sqrtRatioAtTick } from '../lib/v3';
import { useApp } from '../state/app';
import { DistBar } from '../components/RangeChart';

export type V3Position = {
  id: string;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
  fees0: bigint;
  fees1: bigint;
  pool: PoolInfo | null;
  status: 'in' | 'out' | 'closed';
};

async function loadPosition(id: string, account: string | null, pools: PoolInfo[]): Promise<V3Position> {
  const npm = positionManager();
  const p = await npm.methods.positions(id).call();
  const token0 = String(p.token0);
  const token1 = String(p.token1);
  const fee = Number(p.fee);
  const tickLower = Number(p.tickLower);
  const tickUpper = Number(p.tickUpper);
  const liquidity = BigInt(p.liquidity);
  const pool = pools.find((x) => x.version === 'v3' && x.fee === fee && sameAddress(x.token0, token0) && sameAddress(x.token1, token1)) ?? null;
  const [amount0, amount1] = pool?.sqrtPriceX96
    ? amountsForLiquidity(pool.sqrtPriceX96, sqrtRatioAtTick(tickLower), sqrtRatioAtTick(tickUpper), liquidity)
    : [0n, 0n];
  let fees0 = BigInt(p.tokensOwed0);
  let fees1 = BigInt(p.tokensOwed1);
  // A static collect from the owner returns owed fees including the ones the
  // pool has accrued since the last poke.
  const owner = account ?? String(await npm.methods.ownerOf(id).call().catch(() => ''));
  if (owner) {
    try {
      const r = await npm.methods.collect([id, owner, MAX_UINT128, MAX_UINT128]).call({ from: owner });
      fees0 = BigInt(r.amount0 ?? r[0]);
      fees1 = BigInt(r.amount1 ?? r[1]);
    } catch {
      /* keep tokensOwed */
    }
  }
  const status = liquidity === 0n ? 'closed' : pool && pool.tick >= tickLower && pool.tick < tickUpper ? 'in' : 'out';
  return { id, token0, token1, fee, tickLower, tickUpper, liquidity, amount0, amount1, fees0, fees1, pool, status };
}

export function useV3Positions(account: string | null) {
  const { block, pools } = useApp();
  const [positions, setPositions] = useState<V3Position[] | null>(null);
  useEffect(() => {
    if (!account) return setPositions(null);
    let alive = true;
    (async () => {
      const npm = positionManager();
      const count = Number(await npm.methods.balanceOf(account).call());
      const ids: string[] = await Promise.all(Array.from({ length: Math.min(count, 100) }, (_, i) => npm.methods.tokenOfOwnerByIndex(account, i).call().then(String)));
      const list = await Promise.all(ids.map((id) => loadPosition(id, account, pools)));
      if (alive) setPositions(list.sort((a, b) => Number(b.id) - Number(a.id)));
    })().catch(() => alive && setPositions((p) => p ?? []));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, block, pools.length]);
  return positions;
}

export function useV3Position(id: string | undefined, account: string | null) {
  const { block, pools } = useApp();
  const [state, setState] = useState<{ position: V3Position | null; owner: string | null; error: boolean }>({ position: null, owner: null, error: false });
  useEffect(() => {
    if (!id || !pools.length) return;
    let alive = true;
    (async () => {
      const owner = String(await positionManager().methods.ownerOf(id).call());
      const position = await loadPosition(id, owner, pools);
      if (alive) setState({ position, owner, error: false });
    })().catch(() => alive && setState((s) => ({ ...s, error: true })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, account, block, pools]);
  return state;
}

/// Active liquidity at evenly spaced prices around the current tick, from the
/// pool's initialized ticks. Prices are token1 per token0 unless `invert`.
export function useLiquidityBars(pool: PoolInfo | null | undefined, decimals0: number, decimals1: number, invert: boolean): DistBar[] {
  const { block } = useApp();
  const [bars, setBars] = useState<DistBar[]>([]);
  useEffect(() => {
    if (!pool || pool.version !== 'v3' || !pool.sqrtPriceX96) return setBars([]);
    let alive = true;
    (async () => {
      const spacing = pool.tickSpacing;
      const word = Math.floor(Math.floor(pool.tick / spacing) / 256);
      const words = [-2, -1, 0, 1, 2].map((d) => word + d);
      const lens = tickLens();
      const results = await Promise.all(words.map((w) => lens.methods.getPopulatedTicksInWord(pool.address, w).call().catch(() => [])));
      const ticks = results
        .flat()
        .map((t: any) => ({ tick: Number(t.tick ?? t[0]), net: BigInt(t.liquidityNet ?? t[1]) }))
        .sort((a, b) => a.tick - b.tick);
      const active = (tick: number) => {
        let l = pool.liquidity;
        if (tick >= pool.tick) for (const t of ticks) { if (t.tick > pool.tick && t.tick <= tick) l += t.net; }
        else for (const t of [...ticks].reverse()) { if (t.tick <= pool.tick && t.tick > tick) l -= t.net; }
        return l < 0n ? 0n : l;
      };
      const span = Math.max(spacing * 40, ticks.length ? Math.max(...ticks.map((t) => Math.abs(t.tick - pool.tick))) * 1.4 : spacing * 40);
      const out: DistBar[] = [];
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const tick = Math.round(pool.tick - span + (2 * span * i) / steps);
        const price = priceFromTick(tick, decimals0, decimals1);
        out.push({ price: invert ? 1 / price : price, liquidity: Number(active(tick)) });
      }
      if (alive) setBars(out);
    })().catch(() => alive && setBars([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool?.id, pool?.tick, pool?.liquidity, block, invert, decimals0, decimals1]);
  return bars;
}
