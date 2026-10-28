import devnet from '../contracts/devnet.json';
import { ABI, reader } from './chain';
import { asDecoded, gqlAll, indexerBlock } from './indexer';
import { getEvents } from './logs';
import { PoolInfo } from './registry';
import { priceFromSqrt } from './v3';

export type EventKind = 'swap' | 'add' | 'remove';

export type PoolEvent = {
  kind: EventKind;
  block: number;
  logIndex: number;
  hash: string;
  /// Token flows from the pool's point of view: positive means into the pool.
  amount0: bigint;
  amount1: bigint;
  /// Raw (decimals-free) price of token0 in token1 right after the event, when
  /// the event carries it (V2 Sync, V3 Swap).
  rawPrice?: number;
  account?: string;
};

type Cache = { from: number; to: number; events: PoolEvent[] };
const caches = new Map<string, Cache>();
const STEP = 20_000;

const big = (v: unknown) => BigInt(v as string);

function decodeV2(events: any[]): PoolEvent[] {
  const out: PoolEvent[] = [];
  const syncByTx = new Map<string, number>();
  for (const e of events) {
    const v = e.returnValues;
    const base = { block: Number(e.blockNumber), logIndex: Number(e.logIndex), hash: String(e.transactionHash) };
    if (e.event === 'Sync') {
      const r0 = Number(big(v.reserve0));
      if (r0 > 0) syncByTx.set(base.hash, Number(big(v.reserve1)) / r0);
      out.push({ ...base, kind: 'swap', amount0: 0n, amount1: 0n, rawPrice: syncByTx.get(base.hash), account: '__sync' });
    } else if (e.event === 'Swap') {
      out.push({ ...base, kind: 'swap', amount0: big(v.amount0In) - big(v.amount0Out), amount1: big(v.amount1In) - big(v.amount1Out), account: String(v.to) });
    } else if (e.event === 'Mint') {
      out.push({ ...base, kind: 'add', amount0: big(v.amount0), amount1: big(v.amount1) });
    } else if (e.event === 'Burn') {
      out.push({ ...base, kind: 'remove', amount0: -big(v.amount0), amount1: -big(v.amount1), account: String(v.to) });
    }
  }
  // Carry each Sync price onto the swap/mint/burn of the same transaction and
  // keep the Sync rows only where nothing else carries the price.
  const priced = out.map((x) => (x.account === '__sync' ? x : { ...x, rawPrice: syncByTx.get(x.hash) }));
  const covered = new Set(priced.filter((x) => x.account !== '__sync').map((x) => x.hash));
  return priced.filter((x) => x.account !== '__sync' || !covered.has(x.hash)).map((x) => (x.account === '__sync' ? { ...x, account: undefined } : x));
}

function decodeV3(events: any[]): PoolEvent[] {
  return events.flatMap((e): PoolEvent[] => {
    const v = e.returnValues;
    const base = { block: Number(e.blockNumber), logIndex: Number(e.logIndex), hash: String(e.transactionHash) };
    if (e.event === 'Swap') {
      const s = Number(big(v.sqrtPriceX96)) / 2 ** 96;
      return [{ ...base, kind: 'swap', amount0: big(v.amount0), amount1: big(v.amount1), rawPrice: s * s, account: String(v.recipient) }];
    }
    if (e.event === 'Mint') return [{ ...base, kind: 'add', amount0: big(v.amount0), amount1: big(v.amount1) }];
    if (e.event === 'Burn') {
      const a0 = big(v.amount0);
      const a1 = big(v.amount1);
      // NonfungiblePositionManager collects fees with a zero burn; skip those.
      return a0 === 0n && a1 === 0n ? [] : [{ ...base, kind: 'remove', amount0: -a0, amount1: -a1 }];
    }
    return [];
  });
}

/// Exact block timestamps learned from the indexer; `blockTime` in state/app
/// prefers these over its interpolated clock.
export const blockTimes = new Map<number, number>();

type IndexedEvent = {
  kind: 'SWAP' | 'ADD' | 'REMOVE' | 'SYNC';
  block: number;
  logIndex: number;
  timestamp: number;
  txHash: string;
  origin: string | null;
  account: string | null;
  amount0: string;
  amount1: string;
  rawPrice: number | null;
};

const INDEXED_EVENTS = `query($pool: ID!, $from: Int!, $to: Int!, $skip: Int) {
  poolEvents(pools: [$pool], fromBlock: $from, toBlock: $to, first: 1000, skip: $skip, orderDirection: asc) {
    kind block logIndex timestamp txHash origin account amount0 amount1 rawPrice
  }
}`;

/// The same rows decodeV2 / decodeV3 build, from the indexer: price-only Sync
/// rows come back as zero-amount swaps, like decodeV2 keeps them.
async function fetchIndexed(pool: PoolInfo, from: number, to: number): Promise<PoolEvent[]> {
  const rows = await gqlAll<IndexedEvent>('poolEvents', INDEXED_EVENTS, { pool: pool.address, from, to });
  return rows.map((r) => {
    blockTimes.set(r.block, r.timestamp);
    if (r.origin && !senders.has(r.txHash)) senders.set(r.txHash, Promise.resolve(r.origin));
    return {
      kind: r.kind === 'ADD' ? 'add' : r.kind === 'REMOVE' ? 'remove' : 'swap',
      block: r.block,
      logIndex: r.logIndex,
      hash: r.txHash,
      amount0: BigInt(r.amount0),
      amount1: BigInt(r.amount1),
      rawPrice: r.rawPrice ?? undefined,
      account: r.account ? asDecoded(r.account) : undefined,
    };
  });
}

/// Indexed history up to the indexer's block, the newest few blocks from RPC.
async function fetchRange(pool: PoolInfo, from: number, to: number): Promise<PoolEvent[]> {
  const indexed = await indexerBlock(to);
  if (indexed !== null && indexed >= from) {
    try {
      const head = await fetchIndexed(pool, from, Math.min(to, indexed));
      return to > indexed ? [...head, ...(await fetchRangeRpc(pool, indexed + 1, to))] : head;
    } catch {
      // Fall through to the chain.
    }
  }
  return fetchRangeRpc(pool, from, to);
}

async function fetchRangeRpc(pool: PoolInfo, from: number, to: number): Promise<PoolEvent[]> {
  const names = pool.version === 'v2' ? ['Swap', 'Sync', 'Mint', 'Burn'] : ['Swap', 'Mint', 'Burn'];
  const all: any[] = [];
  for (let start = from; start <= to; start += STEP) {
    const end = Math.min(to, start + STEP - 1);
    all.push(...(await getEvents(pool.version === 'v2' ? ABI.pair : ABI.v3Pool, pool.address, names, start, end)));
  }
  all.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber) || Number(a.logIndex) - Number(b.logIndex));
  return pool.version === 'v2' ? decodeV2(all) : decodeV3(all);
}

/// Events of a pool between `fromBlock` and `latest`, cached and extended
/// incrementally on both ends.
export async function poolEvents(pool: PoolInfo, fromBlock: number, latest: number): Promise<PoolEvent[]> {
  const start = Math.max(devnet.startBlock, fromBlock);
  let cache = caches.get(pool.id);
  if (!cache) {
    cache = { from: start, to: latest, events: await fetchRange(pool, start, latest) };
  } else {
    if (start < cache.from) cache = { ...cache, from: start, events: [...(await fetchRange(pool, start, cache.from - 1)), ...cache.events] };
    if (latest > cache.to) cache = { ...cache, to: latest, events: [...cache.events, ...(await fetchRange(pool, cache.to + 1, latest))] };
  }
  caches.set(pool.id, cache);
  return cache.events.filter((e) => e.block >= start);
}

export const humanPrice = (raw: number, decimals0: number, decimals1: number) => raw * 10 ** (decimals0 - decimals1);
export const currentRawPrice = (pool: PoolInfo) =>
  pool.version === 'v3' ? priceFromSqrt(pool.sqrtPriceX96, 0, 0) : pool.reserve0 > 0n ? Number(pool.reserve1) / Number(pool.reserve0) : 0;

/// Senders of a few transactions, for the activity list. V2 events name the
/// router, not the wallet, so the transaction itself is the only source.
const senders = new Map<string, Promise<string | undefined>>();
export function txSender(hash: string): Promise<string | undefined> {
  if (!senders.has(hash)) {
    senders.set(
      hash,
      reader.qrl
        .getTransaction(hash)
        .then((t: any) => (t?.from ? String(t.from) : undefined))
        .catch(() => undefined),
    );
  }
  return senders.get(hash)!;
}

export const WINDOWS = {
  '1h': 3600,
  '6h': 6 * 3600,
  '24h': 86400,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
  All: Infinity,
} as const;
export type WindowKey = keyof typeof WINDOWS;
