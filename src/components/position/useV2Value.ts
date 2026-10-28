import { useEffect, useState } from 'react';
import devnet from '../../contracts/devnet.json';
import { ADDRESSES } from '../../config';
import { ABI, isZero, sameAddress } from '../../lib/chain';
import { toFloat } from '../../lib/format';
import { poolEvents } from '../../lib/history';
import { getEvents } from '../../lib/logs';
import { PoolInfo } from '../../lib/registry';
import { useApp } from '../../state/app';
import { Point } from '../Chart';

type Delta = { block: number; logIndex: number; d0: bigint; d1: bigint; dSupply: bigint; dBalance: bigint };

/// Value in QRL of `account`'s LP tokens over time. Every input is on chain:
/// reserves are walked back from today's through the pair's Swap / Mint / Burn
/// flows, total supply and the account's balance through its LP Transfer logs.
/// QRL pairs value the position at twice its WQRL side (both sides are worth
/// the same in a constant product pool); other pairs use today's QRL prices.
export function useV2Value(pool: PoolInfo | null, account: string | null) {
  const { block, blockTime, priceInQrl, decimalsOf } = useApp();
  const [points, setPoints] = useState<Point[] | null>(null);

  useEffect(() => {
    if (!pool || !account || !block) return setPoints(null);
    let alive = true;
    (async () => {
      const [events, transfers] = await Promise.all([
        poolEvents(pool, devnet.startBlock, block),
        getEvents(ABI.pair, pool.address, ['Transfer'], devnet.startBlock, block),
      ]);
      const deltas: Delta[] = [
        ...events.filter((e) => e.amount0 !== 0n || e.amount1 !== 0n).map((e) => ({ block: e.block, logIndex: e.logIndex, d0: e.amount0, d1: e.amount1, dSupply: 0n, dBalance: 0n })),
        ...transfers.map((t) => {
          const from = String(t.returnValues.from);
          const to = String(t.returnValues.to);
          const v = BigInt(t.returnValues.value);
          return {
            block: t.blockNumber,
            logIndex: t.logIndex,
            d0: 0n,
            d1: 0n,
            dSupply: isZero(from) ? v : isZero(to) ? -v : 0n,
            dBalance: (sameAddress(to, account) ? v : 0n) - (sameAddress(from, account) ? v : 0n),
          };
        }),
      ].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);

      const d0 = decimalsOf(pool.token0);
      const d1 = decimalsOf(pool.token1);
      const wq0 = sameAddress(pool.token0, ADDRESSES.WQRL);
      const wq1 = sameAddress(pool.token1, ADDRESSES.WQRL);
      const p0 = priceInQrl(pool.token0);
      const p1 = priceInQrl(pool.token1);
      const worth = (r0: bigint, r1: bigint, supply: bigint, bal: bigint): number | null => {
        if (supply <= 0n) return 0;
        const share = Number((bal * 1_000_000_000n) / supply) / 1e9;
        if (wq0) return share * 2 * toFloat(r0, d0);
        if (wq1) return share * 2 * toFloat(r1, d1);
        if (p0 === undefined || p1 === undefined) return null;
        return share * (toFloat(r0, d0) * p0 + toFloat(r1, d1) * p1);
      };

      // State after the last event is today's; walk backwards.
      let r0 = pool.reserve0;
      let r1 = pool.reserve1;
      let supply = pool.totalSupply;
      let bal = deltas.reduce((s, x) => s + x.dBalance, 0n);
      const out: Point[] = [];
      const now = worth(r0, r1, supply, bal);
      if (now === null) return alive && setPoints([]);
      out.push({ t: blockTime(block), v: now });
      for (let i = deltas.length - 1; i >= 0; i--) {
        const x = deltas[i];
        const v = worth(r0, r1, supply, bal);
        if (v !== null && (out.length === 0 || out[out.length - 1].t !== blockTime(x.block))) out.push({ t: blockTime(x.block), v });
        r0 -= x.d0;
        r1 -= x.d1;
        supply -= x.dSupply;
        bal -= x.dBalance;
        if (bal <= 0n) break;
      }
      if (alive) setPoints(out.reverse());
    })().catch(() => alive && setPoints([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool?.id, pool?.reserve0, pool?.totalSupply, account, block]);

  return points;
}
