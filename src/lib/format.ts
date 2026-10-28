export function parseUnits(input: string, decimals: number): bigint | null {
  const value = input.trim().replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(value) || value === '' || value === '.') return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) return null;
  return BigInt((whole || '0') + fraction.padEnd(decimals, '0'));
}

export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? '.' + fraction : ''}`;
}

/// Human readable amount: grouped integer part, at most `maxDecimals`
/// significant fraction digits, and a floor marker for dust.
export function formatAmount(value: bigint | undefined, decimals: number, maxDecimals = 4): string {
  if (value === undefined) return '—';
  if (value === 0n) return '0';
  const exact = formatUnits(value, decimals);
  const [whole, fraction = ''] = exact.split('.');
  const grouped = BigInt(whole).toLocaleString('en-US');
  if (whole === '0') {
    const firstNonZero = fraction.search(/[1-9]/);
    if (firstNonZero >= 8) return '<0.00000001';
    const shown = fraction.slice(0, Math.max(maxDecimals, firstNonZero + 2)).replace(/0+$/, '');
    return `0.${shown}`;
  }
  const shown = fraction.slice(0, whole.length > 6 ? 2 : maxDecimals).replace(/0+$/, '');
  return shown ? `${grouped}.${shown}` : grouped;
}

/// Input-friendly representation (no grouping) trimmed to a sensible length.
export function toInputString(value: bigint, decimals: number, maxDecimals = 8): string {
  const exact = formatUnits(value, decimals);
  const [whole, fraction = ''] = exact.split('.');
  // Dust keeps a few significant digits instead of collapsing to "0".
  const firstNonZero = fraction.search(/[1-9]/);
  const keep = whole === '0' && firstNonZero >= maxDecimals ? firstNonZero + 4 : maxDecimals;
  const shown = fraction.slice(0, keep).replace(/0+$/, '');
  return shown ? `${whole}.${shown}` : whole;
}

export function toFloat(value: bigint, decimals: number): number {
  return Number(formatUnits(value, decimals));
}

export const formatPercent = (fraction: number, digits = 2) =>
  `${(fraction * 100).toFixed(fraction !== 0 && Math.abs(fraction) < 0.0001 ? 4 : digits)}%`;

export function formatPrice(price: number): string {
  if (price === 0) return '0';
  if (!Number.isFinite(price)) return '—';
  if (price >= 1e6) return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 1) return price.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return price.toPrecision(4);
}

export function sqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

export const applySlippage = (amount: bigint, bps: number, direction: 'down' | 'up') =>
  direction === 'down' ? (amount * BigInt(10_000 - bps)) / 10_000n : (amount * BigInt(10_000 + bps)) / 10_000n;

export function timeAgo(timestamp: number): string {
  const s = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
