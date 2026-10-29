import { describe, expect, it } from 'vitest';
import { ADDRESS_THIS, feeOf, grossFor, MAX_FEE_BIPS, MSG_SENDER, netOf, parseFee } from '../src/lib/fee';

const TREASURY = 'Q' + 'ab'.repeat(64);

describe('interface fee', () => {
  it('rounds the fee down like sweepTokenWithFee', () => {
    expect(feeOf(10_000n, 25)).toBe(25n);
    expect(feeOf(399n, 25)).toBe(0n);
    expect(feeOf(400n, 25)).toBe(1n);
    expect(netOf(10n ** 18n, 25)).toBe(10n ** 18n - 25n * 10n ** 14n);
  });

  it('grossFor is the smallest gross that nets the amount', () => {
    for (const bips of [1, 25, 100]) {
      for (const net of [1n, 2n, 399n, 400n, 401n, 10n ** 6n, 10n ** 18n + 7n, 123456789012345678901n]) {
        const gross = grossFor(net, bips);
        expect(netOf(gross, bips) >= net, `${bips} ${net}`).toBe(true);
        expect(netOf(gross - 1n, bips) < net, `${bips} ${net} not minimal`).toBe(true);
      }
    }
    expect(grossFor(123n, 0)).toBe(123n);
  });

  it('parses the build settings', () => {
    expect(parseFee('25', TREASURY)).toEqual({ bips: 25, recipient: TREASURY });
    expect(parseFee('0', TREASURY)).toBeNull();
    expect(parseFee(String(MAX_FEE_BIPS + 1), TREASURY)).toBeNull();
    expect(parseFee('2.5', TREASURY)).toBeNull();
    expect(parseFee('25', '')).toBeNull();
    expect(parseFee('25', '0x' + 'ab'.repeat(20))).toBeNull();
  });

  it('spells the router flags as 64 byte addresses', () => {
    expect(MSG_SENDER).toMatch(/^Q0{127}1$/);
    expect(ADDRESS_THIS).toMatch(/^Q0{127}2$/);
  });
});
