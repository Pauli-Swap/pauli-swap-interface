import { describe, expect, it } from 'vitest';
import { batches, holdings, NO, payees, payout, YES } from '../src/lib/payout';
import { DecodedEvent } from '../src/lib/logs';

const A = 'Q' + 'aa'.repeat(64);
const B = 'Q' + 'bb'.repeat(64);
const C = 'Q' + 'cc'.repeat(64);
let n = 0;
const ev = (event: string, v: Record<string, unknown>): DecodedEvent => ({ event, returnValues: v, blockNumber: ++n, logIndex: 0, transactionHash: '0x' });

describe('settle payees', () => {
  const log = [
    ev('Bought', { id: 0, user: A, outcome: YES, xpIn: 6n, shares: 11n }),
    ev('Bought', { id: 0, user: B, outcome: NO, xpIn: 6n, shares: 12n }),
    ev('Bought', { id: 0, user: C, outcome: YES, xpIn: 4n, shares: 8n }),
    ev('Sold', { id: 0, user: C, outcome: YES, xpOut: 1n, shares: 3n }),
    ev('Bought', { id: 1, user: A, outcome: NO, xpIn: 1n, shares: 2n }),
  ];

  it('replays shares per wallet and market', () => {
    const rows = holdings(log, 0);
    expect(rows.map((h) => [h.user, h.yesShares, h.noShares])).toEqual([
      [A, 11n, 0n],
      [B, 0n, 12n],
      [C, 5n, 0n],
    ]);
  });

  it('pays winners only, or half of every share when cancelled', () => {
    const rows = holdings(log, 0);
    expect(payees(rows, YES)).toEqual({ users: [A, C], xp: 16n });
    expect(payees(rows, NO)).toEqual({ users: [B], xp: 12n });
    expect(payout({ yesShares: 5n, noShares: 4n }, null)).toBe(4n);
  });

  it('drops a wallet once it is paid', () => {
    const rows = holdings([...log, ev('Claimed', { id: 0, user: B, xp: 12n })], 0);
    expect(payees(rows, NO).users).toEqual([]);
    expect(rows.length).toBe(2);
  });

  it('splits users into settle batches', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 20)).toEqual([]);
  });
});
