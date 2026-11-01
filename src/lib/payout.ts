import type { DecodedEvent } from './logs';

/// Settle payouts, kept free of config and the RPC client so tests can load it.

export const YES = 0;
export const NO = 1;
export type Outcome = typeof YES | typeof NO;

export type Holding = { user: string; yesShares: bigint; noShares: bigint };

/// Shares each wallet still holds in market `id`, replayed from Bought, Sold
/// and Claimed (claim and settle both delete the position).
export function holdings(log: DecodedEvent[], id: number): Holding[] {
  const rows = new Map<string, Holding>();
  for (const e of log) {
    const v = e.returnValues;
    if (Number(v.id) !== id || (e.event !== 'Bought' && e.event !== 'Sold' && e.event !== 'Claimed')) continue;
    const key = String(v.user).toLowerCase();
    if (e.event === 'Claimed') {
      rows.delete(key);
      continue;
    }
    const row = rows.get(key) ?? { user: String(v.user), yesShares: 0n, noShares: 0n };
    const delta = e.event === 'Bought' ? BigInt(v.shares) : -BigInt(v.shares);
    if (Number(v.outcome) === YES) row.yesShares += delta;
    else row.noShares += delta;
    rows.set(key, row);
  }
  return [...rows.values()].filter((h) => h.yesShares > 0n || h.noShares > 0n);
}

/// What claim / settle pays `h` once the market is resolved to `outcome`, or
/// cancelled (outcome null): the winning shares, or half of all shares.
export const payout = (h: Pick<Holding, 'yesShares' | 'noShares'>, outcome: Outcome | null) =>
  outcome === null ? (h.yesShares + h.noShares) / 2n : outcome === YES ? h.yesShares : h.noShares;

/// Wallets settle would pay, and the XP in total.
export function payees(rows: Holding[], outcome: Outcome | null) {
  const paid = rows.filter((h) => payout(h, outcome) > 0n);
  return { users: paid.map((h) => h.user), xp: paid.reduce((s, h) => s + payout(h, outcome), 0n) };
}

/// Users per settle transaction; the attester uses the same batch
/// (about 400k gas for 20 winners on the devnet).
export const SETTLE_BATCH = 20;

export const batches = <T>(list: T[], size = SETTLE_BATCH): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
