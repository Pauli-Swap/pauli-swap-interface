import { describe, expect, it } from 'vitest';
import vectors from './fixtures/v3-vectors.json';
import {
  amount0ForLiquidity,
  amount1ForLiquidity,
  amountsForLiquidity,
  dependentAmount,
  encodePath,
  encodeSqrtRatioX96,
  liquidityForAmount0,
  liquidityForAmount1,
  liquidityForAmounts,
  MAX_TICK,
  MIN_TICK,
  nearestUsableTick,
  Q96,
  sortTokens,
  sqrtRatioAtTick,
  tickAtSqrtRatio,
  tickFromPrice,
} from '../src/lib/v3';

type Vector = { method: string; args: string[]; result: string };
const of = (method: string) => (vectors.vectors as Vector[]).filter((v) => v.method === method);
const ok = (v: Vector) => v.result.startsWith('ok:');
const value = (v: Vector) => BigInt(v.result.slice(3));

// The vectors are the pool's own TickMath / SqrtPriceMath answers on the
// devnet (and on the 20 byte build, which agreed on all of them).
describe('V3 math against the on-chain vectors', () => {
  it('sqrtRatioAtTick matches TickMath.getSqrtRatioAtTick', () => {
    const vs = of('getSqrtRatioAtTick');
    expect(vs.length).toBeGreaterThan(100);
    for (const v of vs) {
      const tick = Number(v.args[0]);
      if (ok(v)) expect(sqrtRatioAtTick(tick), `tick ${tick}`).toBe(value(v));
      else expect(() => sqrtRatioAtTick(tick)).toThrow();
    }
  });

  it('tickAtSqrtRatio matches TickMath.getTickAtSqrtRatio inside its domain', () => {
    const vs = of('getTickAtSqrtRatio').filter(ok);
    expect(vs.length).toBeGreaterThan(100);
    for (const v of vs) expect(tickAtSqrtRatio(BigInt(v.args[0])), v.args[0]).toBe(Number(value(v)));
  });

  // LiquidityAmounts' getAmountsForLiquidity rounds down, which is
  // SqrtPriceMath's getAmount0Delta / getAmount1Delta with roundUp false.
  it('amount0ForLiquidity matches getAmount0Delta rounding down', () => {
    const vs = of('getAmount0Delta').filter((v) => v.args[3] === 'false' && ok(v));
    expect(vs.length).toBeGreaterThan(20);
    for (const v of vs) expect(amount0ForLiquidity(BigInt(v.args[0]), BigInt(v.args[1]), BigInt(v.args[2]))).toBe(value(v));
  });

  it('amount1ForLiquidity matches getAmount1Delta rounding down', () => {
    const vs = of('getAmount1Delta').filter((v) => v.args[3] === 'false' && ok(v));
    expect(vs.length).toBeGreaterThan(20);
    for (const v of vs) expect(amount1ForLiquidity(BigInt(v.args[0]), BigInt(v.args[1]), BigInt(v.args[2]))).toBe(value(v));
  });
});

/// LiquidityAmounts.sol, written out from upstream for comparison.
const mulDiv = (a: bigint, b: bigint, d: bigint) => (a * b) / d;
const refLiquidity0 = (a: bigint, b: bigint, amount0: bigint) => mulDiv(amount0, mulDiv(a, b, Q96), b - a);

describe('liquidity for amounts', () => {
  const ticks = [-887220, -200000, -600, -1, 0, 1, 600, 120000, 887220];

  it('liquidityForAmount0 rounds like LiquidityAmounts.getLiquidityForAmount0', () => {
    for (const lo of ticks)
      for (const hi of ticks) {
        if (lo >= hi) continue;
        const [a, b] = [sqrtRatioAtTick(lo), sqrtRatioAtTick(hi)];
        for (const amount of [1n, 10n ** 6n, 10n ** 18n, 123456789n * 10n ** 18n]) {
          expect(liquidityForAmount0(a, b, amount), `${lo}..${hi} ${amount}`).toBe(refLiquidity0(a, b, amount));
        }
      }
  });

  it('never asks for more than the amounts it was given', () => {
    const p = sqrtRatioAtTick(199);
    for (const [lo, hi] of [[-600, 600], [-887220, 887220], [0, 600], [-60, 180]]) {
      const [a, b] = [sqrtRatioAtTick(lo), sqrtRatioAtTick(hi)];
      const amount0 = 10n ** 18n;
      const amount1 = 3n * 10n ** 18n;
      const L = liquidityForAmounts(p, a, b, amount0, amount1);
      const [x, y] = amountsForLiquidity(p, a, b, L);
      expect(x <= amount0 && y <= amount1, `${lo}..${hi}`).toBe(true);
    }
  });

  it('dependentAmount fills the same liquidity from either side', () => {
    const p = sqrtRatioAtTick(199);
    const amount0 = 5n * 10n ** 18n;
    const amount1 = dependentAmount(0, amount0, p, -600, 600);
    const [a, b] = [sqrtRatioAtTick(-600), sqrtRatioAtTick(600)];
    const L0 = liquidityForAmount0(p, b, amount0);
    const L1 = liquidityForAmount1(a, p, amount1);
    // The two sides agree to within rounding of the smaller one.
    expect(L1 <= L0 && L0 - L1 < L0 / 10n ** 12n).toBe(true);
    expect(dependentAmount(0, amount0, p, 600, 1200)).toBe(0n);
  });
});

describe('ticks and prices', () => {
  it('tickAtSqrtRatio inverts sqrtRatioAtTick', () => {
    for (const t of [MIN_TICK, -500000, -1, 0, 1, 199, 500000, MAX_TICK - 1]) expect(tickAtSqrtRatio(sqrtRatioAtTick(t))).toBe(t);
  });

  it('tickFromPrice is within one tick of the exact tick', () => {
    for (const t of [-100000, -601, 0, 7, 199, 100000]) {
      const price = Math.pow(1.0001, t);
      expect(Math.abs(tickFromPrice(price, 18, 18) - t)).toBeLessThanOrEqual(1);
    }
  });

  it('nearestUsableTick snaps to spacing and stays in range', () => {
    expect(nearestUsableTick(199, 60)).toBe(180);
    expect(nearestUsableTick(-31, 60)).toBe(-60);
    expect(nearestUsableTick(MAX_TICK, 60)).toBe(887220);
    expect(nearestUsableTick(MIN_TICK, 200)).toBe(-887200);
  });

  it('encodeSqrtRatioX96 gives 1:1 at Q96', () => {
    expect(encodeSqrtRatioX96(1n, 1n)).toBe(Q96);
    expect(encodeSqrtRatioX96(4n, 1n)).toBe(2n * Q96);
  });
});

describe('encodePath', () => {
  const A = 'Q' + 'a'.repeat(128);
  const B = 'Q' + '0'.repeat(127) + 'b';
  it('packs 64 byte tokens and 3 byte fees', () => {
    const path = encodePath([A, B, A], [500, 3000]);
    expect(path.length).toBe(2 + (64 * 3 + 3 * 2) * 2);
    expect(path.slice(2, 130)).toBe('a'.repeat(128));
    expect(path.slice(130, 136)).toBe('0001f4');
    expect(path.slice(264, 270)).toBe('000bb8');
  });
  it('needs one more token than fees', () => {
    expect(() => encodePath([A, B], [500, 3000])).toThrow();
  });
  it('sortTokens orders numerically', () => {
    expect(sortTokens(A, B)).toEqual([B, A]);
  });
});
