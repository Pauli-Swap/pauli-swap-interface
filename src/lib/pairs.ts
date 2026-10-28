import { factory, isZero, pair, sameAddress } from './chain';

export type PairState = {
  address: string;
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
};

const pairAddressCache = new Map<string, Promise<string | null>>();
const cacheKey = (a: string, b: string) => [a.toLowerCase(), b.toLowerCase()].sort().join(':');

/// QIP-55 pair addresses come from Keccak-512 CREATE2, which nothing in the
/// browser computes, so the factory mapping is the only source (docs/QRVM.md Q1).
export function getPairAddress(a: string, b: string): Promise<string | null> {
  const key = cacheKey(a, b);
  const cached = pairAddressCache.get(key);
  if (cached) return cached;
  const promise = factory()
    .methods.getPair(a, b)
    .call()
    .then((address: string) => (isZero(address) ? null : address));
  // A missing pair can be created at any moment; only remember hits.
  promise.then((address) => !address && pairAddressCache.delete(key)).catch(() => pairAddressCache.delete(key));
  pairAddressCache.set(key, promise);
  return promise;
}

export async function getPairState(address: string): Promise<PairState> {
  const c = pair(address);
  const [token0, token1, reserves, totalSupply] = await Promise.all([
    c.methods.token0().call(),
    c.methods.token1().call(),
    c.methods.getReserves().call(),
    c.methods.totalSupply().call(),
  ]);
  return {
    address,
    token0,
    token1,
    reserve0: BigInt(reserves[0] ?? reserves.reserve0),
    reserve1: BigInt(reserves[1] ?? reserves.reserve1),
    totalSupply: BigInt(totalSupply),
  };
}

/// Reserves ordered as (reserve of `tokenA`, reserve of `tokenB`).
export function orderedReserves(state: PairState, tokenA: string): [bigint, bigint] {
  return sameAddress(state.token0, tokenA) ? [state.reserve0, state.reserve1] : [state.reserve1, state.reserve0];
}
