import { PREDICT } from '../config';
import { ABI } from './chain';
import { formatUnits } from './format';
import { DecodedEvent, getEvents } from './logs';

export const XP_DECIMALS = 18;
export const ONE_XP = 10n ** 18n;

export const YES = 0;
export const NO = 1;
export type Outcome = typeof YES | typeof NO;

export const OPEN = 0;
export const RESOLVED = 1;
export const CANCELLED = 2;

/// 1st, 2nd and 3rd place (PRODUCT.md §1); no other prize bands exist.
export const PRIZES = ['Qurrl WL + 10 QRL', 'Qurrl WL', 'Qurrl WL'] as const;
export const QURRL_URL = 'https://quantumark.fi/qurrl';

export type Pools = { poolYes: bigint; poolNo: bigint };

const divUp = (a: bigint, b: bigint) => (a + b - 1n) / b;

/// Mirrors PredictMarket.quoteBuy: shares of `outcome` paid for `xpIn`.
export function quoteBuy(m: Pools, outcome: Outcome, xpIn: bigint): bigint {
  if (xpIn <= 0n) return 0n;
  const [buy, other] = outcome === YES ? [m.poolYes, m.poolNo] : [m.poolNo, m.poolYes];
  return buy + xpIn - divUp(buy * other, other + xpIn);
}

/// Mirrors PredictMarket.quoteSell: shares the pool takes back to pay `xpOut`;
/// null where the contract reverts with "PM: too much".
export function quoteSell(m: Pools, outcome: Outcome, xpOut: bigint): bigint | null {
  if (xpOut <= 0n) return 0n;
  const [sell, other] = outcome === YES ? [m.poolYes, m.poolNo] : [m.poolNo, m.poolYes];
  if (xpOut >= other) return null;
  return divUp(sell * other, other - xpOut) + xpOut - sell;
}

/// Most XP that selling at most `shares` can return. quoteSell grows with
/// xpOut, so a binary search over wei finds the boundary exactly.
export function maxSellXp(m: Pools, outcome: Outcome, shares: bigint): bigint {
  if (shares <= 0n) return 0n;
  let lo = 0n;
  let hi = (outcome === YES ? m.poolNo : m.poolYes) - 1n;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    const need = quoteSell(m, outcome, mid);
    if (need !== null && need <= shares) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

/// Probability of Yes, which is also the XP price of a Yes share since a
/// winning share redeems for 1 XP.
export const priceYes = (m: Pools) => (m.poolYes + m.poolNo > 0n ? Number((m.poolNo * 1_000_000n) / (m.poolYes + m.poolNo)) / 1_000_000 : 0.5);

/// Pool reserves after one trade, as PredictMarket.buy / sell write them.
export function applyTrade(m: Pools, e: DecodedEvent): Pools {
  const v = e.returnValues;
  const outcome = Number(v.outcome);
  if (e.event === 'Bought') {
    const xpIn = BigInt(v.xpIn);
    const shares = BigInt(v.shares);
    return outcome === YES
      ? { poolYes: m.poolYes + xpIn - shares, poolNo: m.poolNo + xpIn }
      : { poolYes: m.poolYes + xpIn, poolNo: m.poolNo + xpIn - shares };
  }
  if (e.event === 'Sold') {
    const xpOut = BigInt(v.xpOut);
    const shares = BigInt(v.shares);
    return outcome === YES
      ? { poolYes: m.poolYes + shares - xpOut, poolNo: m.poolNo - xpOut }
      : { poolYes: m.poolYes - xpOut, poolNo: m.poolNo + shares - xpOut };
  }
  return m;
}

export const xpFloat = (v: bigint) => Number(formatUnits(v, XP_DECIMALS));

/// "2,860 XP", "48.2K XP", "0.25 XP".
export function fmtXp(v: bigint | number | null | undefined, { compact = false, unit = true } = {}): string {
  if (v === null || v === undefined) return '—';
  const n = typeof v === 'bigint' ? xpFloat(v) : v;
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  let s: string;
  if (compact && abs >= 1e6) s = `${(n / 1e6).toFixed(1)}M`;
  else if (compact && abs >= 1e4) s = `${(n / 1e3).toFixed(1)}K`;
  else if (abs >= 100 || n === 0) s = Math.round(n).toLocaleString('en-US');
  else if (abs >= 0.01) s = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  else s = '<0.01';
  return unit ? `${s} XP` : s;
}

/// Share price in XP, "0.62 XP".
export const fmtPrice = (p: number) => `${p.toFixed(2)} XP`;
export const fmtChance = (p: number) => `${Math.round(p * 100)}%`;

export const MARKET_EVENTS = ['MarketCreated', 'Bought', 'Sold', 'MarketResolved', 'MarketCancelled', 'Claimed'];
export const XP_EVENTS = ['XPCredited', 'XPDebited', 'QuestCompleted', 'SeasonStarted', 'SeasonClosed'];

const STEP = 20_000;
type Log = { to: number; events: DecodedEvent[] };
const logs = new Map<string, Log>();
const inflight = new Map<string, Promise<DecodedEvent[]>>();

/// Every event of a Predict contract since its deployment, cached and
/// extended as the head moves. Both contracts are small (a season has a few
/// markets and 3 to 20 players), so the whole history stays in memory.
export function contractLog(kind: 'market' | 'xp', latest: number): Promise<DecodedEvent[]> {
  const cached = logs.get(kind);
  if (cached && cached.to >= latest) return Promise.resolve(cached.events);
  const running = inflight.get(kind);
  if (running) return running;
  const [abi, address, names] = kind === 'market' ? [ABI.predictMarket, PREDICT.market, MARKET_EVENTS] : [ABI.predictXP, PREDICT.xp, XP_EVENTS];
  const job = (async () => {
    const from = cached ? cached.to + 1 : PREDICT.startBlock;
    const fresh: DecodedEvent[] = [];
    for (let start = from; start <= latest; start += STEP) {
      fresh.push(...(await getEvents(abi, address, names, start, Math.min(latest, start + STEP - 1))));
    }
    fresh.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    const events = [...(cached?.events ?? []), ...fresh];
    logs.set(kind, { to: latest, events });
    return events;
  })().finally(() => inflight.delete(kind));
  inflight.set(kind, job);
  return job;
}
