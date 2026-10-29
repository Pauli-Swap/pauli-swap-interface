/// The interface fee, Uniswap style: this front end routes swaps through
/// SwapRouter02 to the router itself and pays the output out with
/// sweepTokenWithFee / unwrapWQRL9WithFee, keeping `bips` of it. Pools charge
/// their own LP fee either way; calling the contracts directly skips this one.
/// Wrapping and unwrapping are never charged.

/// SwapRouter02 refuses more than 100 bips (1%).
export const MAX_FEE_BIPS = 100;

/// Fee on a gross output, rounded down like the router.
export const feeOf = (gross: bigint, bips: number) => (gross * BigInt(bips)) / 10_000n;

/// What the recipient gets from a gross output.
export const netOf = (gross: bigint, bips: number) => gross - feeOf(gross, bips);

/// The smallest gross output whose net is at least `net`, for exact output
/// swaps: the router is asked for this much, so the wallet receives `net`.
export function grossFor(net: bigint, bips: number): bigint {
  if (bips <= 0) return net;
  const keep = 10_000n - BigInt(bips);
  let gross = (net * 10_000n + keep - 1n) / keep;
  // The ceiling above already suffices; step down while a smaller gross still nets `net`.
  while (gross > net && netOf(gross - 1n, bips) >= net) gross -= 1n;
  return gross;
}

/// The QIP-55 spelling of SwapRouter02's recipient flags (Constants.hyp).
export const MSG_SENDER = 'Q' + '0'.repeat(127) + '1';
export const ADDRESS_THIS = 'Q' + '0'.repeat(127) + '2';

export type InterfaceFee = { bips: number; recipient: string };

/// The fee from the build's VITE_* settings, or null when it is off or misconfigured.
export function parseFee(bipsValue: string | undefined, recipient: string | undefined): InterfaceFee | null {
  const bips = Number(bipsValue ?? '0');
  if (!Number.isInteger(bips) || bips <= 0 || bips > MAX_FEE_BIPS) return null;
  if (!recipient || !/^Q[0-9a-fA-F]{128}$/.test(recipient.trim())) return null;
  return { bips, recipient: recipient.trim() };
}
