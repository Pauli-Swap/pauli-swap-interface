import devnet from '../contracts/devnet.json';
import { ADDRESSES } from '../config';
import { ABI, factory, pair, sameAddress, token as tokenContract, v3Pool } from './chain';
import { asDecoded, gqlAll, indexerBlock } from './indexer';
import { getEvents } from './logs';
import { toFloat } from './format';
import { priceFromSqrt, tickSpacingOf } from './v3';

export type Version = 'v2' | 'v3';

export type PoolInfo = {
  id: string;
  version: Version;
  address: string;
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  /// V2: pair reserves. V3: the pool's token balances, which is what TVL means
  /// for concentrated liquidity.
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
};

export const poolId = (version: Version, address: string) => `${version}:${address.toLowerCase()}`;

type Known = { version: Version; address: string; token0: string; token1: string; fee: number };
const known = new Map<string, Known>();
let v2Count = 0;
let v3ScannedTo = devnet.startBlock - 1;

type IndexedPool = { id: string; version: number; token0: string; token1: string; fee: number };

/// Pools the indexer already knows, so the RPC scans below only cover what
/// came after its block. Creation order matches allPairs order for V2.
async function discoverIndexed(latest: number) {
  const indexed = await indexerBlock(latest);
  if (indexed === null || indexed <= v3ScannedTo) return;
  try {
    const pools = await gqlAll<IndexedPool>('pools', 'query($skip: Int) { pools(first: 1000, skip: $skip) { id version token0 token1 fee } }', {});
    let v2 = 0;
    for (const p of pools) {
      const version = p.version === 2 ? 'v2' : 'v3';
      if (version === 'v2') v2++;
      known.set(poolId(version, p.id), { version, address: asDecoded(p.id), token0: asDecoded(p.token0), token1: asDecoded(p.token1), fee: p.fee });
    }
    v2Count = Math.max(v2Count, Math.min(v2, 500));
    v3ScannedTo = Math.max(v3ScannedTo, indexed);
  } catch {
    // The RPC scans below cover everything.
  }
}

async function discover(latest: number) {
  await discoverIndexed(latest);
  const f2 = factory();
  const count = Math.min(Number(await f2.methods.allPairsLength().call()), 500);
  if (count > v2Count) {
    const fresh = await Promise.all(
      Array.from({ length: count - v2Count }, async (_, i) => {
        const address: string = await f2.methods.allPairs(v2Count + i).call();
        const c = pair(address);
        const [token0, token1] = await Promise.all([c.methods.token0().call(), c.methods.token1().call()]);
        return { version: 'v2' as const, address, token0: String(token0), token1: String(token1), fee: 3000 };
      }),
    );
    for (const k of fresh) known.set(poolId('v2', k.address), k);
    v2Count = count;
  }
  if (latest > v3ScannedTo) {
    const step = 20_000;
    for (let from = v3ScannedTo + 1; from <= latest; from += step) {
      const to = Math.min(latest, from + step - 1);
      const events = await getEvents(ABI.v3Factory, ADDRESSES.PauliV3Factory, ['PoolCreated'], from, to);
      for (const e of events) {
        const v = e.returnValues;
        const address = String(v.pool);
        known.set(poolId('v3', address), { version: 'v3', address, token0: String(v.token0), token1: String(v.token1), fee: Number(v.fee) });
      }
      v3ScannedTo = to;
    }
  }
}

async function loadState(k: Known): Promise<PoolInfo> {
  const base = { id: poolId(k.version, k.address), ...k, tickSpacing: tickSpacingOf(k.fee) };
  if (k.version === 'v2') {
    const c = pair(k.address);
    const [reserves, totalSupply] = await Promise.all([c.methods.getReserves().call(), c.methods.totalSupply().call()]);
    return {
      ...base,
      reserve0: BigInt(reserves[0] ?? reserves.reserve0),
      reserve1: BigInt(reserves[1] ?? reserves.reserve1),
      totalSupply: BigInt(totalSupply),
      sqrtPriceX96: 0n,
      tick: 0,
      liquidity: 0n,
    };
  }
  const c = v3Pool(k.address);
  const [slot0, liquidity, b0, b1] = await Promise.all([
    c.methods.slot0().call(),
    c.methods.liquidity().call(),
    tokenContract(k.token0).methods.balanceOf(k.address).call(),
    tokenContract(k.token1).methods.balanceOf(k.address).call(),
  ]);
  return {
    ...base,
    reserve0: BigInt(b0),
    reserve1: BigInt(b1),
    totalSupply: 0n,
    sqrtPriceX96: BigInt(slot0.sqrtPriceX96 ?? slot0[0]),
    tick: Number(slot0.tick ?? slot0[1]),
    liquidity: BigInt(liquidity),
  };
}

/// `onDiscovered` gets the pool list before the state reads, so token metadata
/// can load alongside them instead of after.
export async function loadPools(latest: number, onDiscovered?: (pools: Known[]) => void): Promise<PoolInfo[]> {
  await discover(latest);
  onDiscovered?.([...known.values()]);
  const states = await Promise.all([...known.values()].map((k) => loadState(k).catch(() => null)));
  return states.filter((p): p is PoolInfo => !!p);
}

export const poolTokens = (pools: { token0: string; token1: string }[]) => {
  const all = new Map<string, string>([[ADDRESSES.WQRL.toLowerCase(), ADDRESSES.WQRL]]);
  for (const p of pools) {
    all.set(p.token0.toLowerCase(), p.token0);
    all.set(p.token1.toLowerCase(), p.token1);
  }
  return [...all.values()];
};

/// Mid price of token0 in token1, in human units.
export function midPrice(p: PoolInfo, decimals0: number, decimals1: number): number {
  if (p.version === 'v3') return p.sqrtPriceX96 ? priceFromSqrt(p.sqrtPriceX96, decimals0, decimals1) : 0;
  const r0 = toFloat(p.reserve0, decimals0);
  return r0 > 0 ? toFloat(p.reserve1, decimals1) / r0 : 0;
}

/// Price of every reachable token in QRL, walking outward from WQRL through
/// the deepest pool at each step. Unreachable tokens are absent.
export function qrlPrices(pools: PoolInfo[], decimalsOf: (address: string) => number): Map<string, number> {
  const prices = new Map<string, number>([[ADDRESSES.WQRL.toLowerCase(), 1]]);
  const usable = pools.filter((p) => p.reserve0 > 0n && p.reserve1 > 0n && (p.version === 'v2' || p.liquidity > 0n));
  let frontier = [ADDRESSES.WQRL.toLowerCase()];
  while (frontier.length) {
    const next: string[] = [];
    for (const from of frontier) {
      const candidates = usable
        .filter((p) => sameAddress(p.token0, from) || sameAddress(p.token1, from))
        .map((p) => {
          const fromIs0 = sameAddress(p.token0, from);
          const other = (fromIs0 ? p.token1 : p.token0).toLowerCase();
          const depth = toFloat(fromIs0 ? p.reserve0 : p.reserve1, decimalsOf(from));
          return { p, other, depth, fromIs0 };
        })
        .filter((c) => !prices.has(c.other))
        .sort((a, b) => b.depth - a.depth);
      for (const c of candidates) {
        if (prices.has(c.other)) continue;
        const mid = midPrice(c.p, decimalsOf(c.p.token0), decimalsOf(c.p.token1));
        if (!(mid > 0)) continue;
        const otherPerFrom = c.fromIs0 ? mid : 1 / mid;
        prices.set(c.other, prices.get(from)! / otherPerFrom);
        next.push(c.other);
      }
    }
    frontier = next;
  }
  return prices;
}

export function tvlInQrl(p: PoolInfo, prices: Map<string, number>, decimalsOf: (a: string) => number): number | null {
  const p0 = prices.get(p.token0.toLowerCase());
  const p1 = prices.get(p.token1.toLowerCase());
  if (p0 === undefined || p1 === undefined) return null;
  return toFloat(p.reserve0, decimalsOf(p.token0)) * p0 + toFloat(p.reserve1, decimalsOf(p.token1)) * p1;
}
