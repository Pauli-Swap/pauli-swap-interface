import { ADDRESSES } from '../config';
import { sameAddress, token as tokenContract } from './chain';
import { load, save } from './storage';

export type Token = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  native?: boolean;
  imported?: boolean;
};

export const NATIVE: Token = { address: 'native', symbol: 'QRL', name: 'QRL · native coin', decimals: 18, native: true };

export const isNative = (t?: Token | null) => !!t?.native;
export const isWqrl = (t?: Token | null) => !!t && !t.native && sameAddress(t.address, ADDRESSES.WQRL);
/// Address a token occupies inside pairs: native QRL trades as WQRL.
export const wrappedAddress = (t: Token) => (t.native ? ADDRESSES.WQRL : t.address);
export const tokenKey = (t: Token) => (t.native ? 'native' : t.address.toLowerCase());
export const sameToken = (a?: Token | null, b?: Token | null) => !!a && !!b && tokenKey(a) === tokenKey(b);

const IMPORTED_KEY = 'acorn.importedTokens';
const metadataCache = new Map<string, Promise<Token>>();

export function fetchTokenMetadata(address: string): Promise<Token> {
  const key = address.toLowerCase();
  if (!metadataCache.has(key)) {
    const c = tokenContract(address);
    const promise = Promise.all([
      c.methods.symbol().call(),
      c.methods.name().call(),
      c.methods.decimals().call(),
    ]).then(([symbol, name, decimals]) => ({ address, symbol: String(symbol), name: String(name), decimals: Number(decimals) }));
    promise.catch(() => metadataCache.delete(key));
    metadataCache.set(key, promise);
  }
  return metadataCache.get(key)!;
}

export const importedTokens = (): Token[] => load<Token[]>(IMPORTED_KEY, []);

export function importToken(t: Token) {
  const list = importedTokens().filter((x) => !sameAddress(x.address, t.address));
  save(IMPORTED_KEY, [...list, { ...t, imported: true }]);
}

/// The default list is every token that sits in a V2 pair or V3 pool, plus
/// WQRL and user imports. There is no curated list on a devnet.
export async function discoverTokens(addresses: string[]): Promise<Token[]> {
  const unique = [...new Map([ADDRESSES.WQRL, ...addresses].map((a) => [a.toLowerCase(), a])).values()];
  const discovered = await Promise.all(unique.map((a) => fetchTokenMetadata(a).catch(() => null)));
  const tokens = [NATIVE, ...discovered.filter((t): t is Token => !!t)];
  for (const t of importedTokens()) if (!tokens.some((x) => sameToken(x, t))) tokens.push(t);
  return tokens;
}

/// Several devnet test tokens report the same symbol, so the UI appends a short
/// address whenever a symbol is ambiguous within the current list.
export function displaySymbol(t: Token | null | undefined, all: Token[]): string {
  if (!t) return '';
  if (t.native) return t.symbol;
  const clash = all.some((x) => !x.native && x.symbol === t.symbol && !sameAddress(x.address, t.address));
  return clash ? `${t.symbol} ${t.address.slice(1, 5)}` : t.symbol;
}

const GRADIENTS: [string, string][] = [
  ['#93B847', '#4D6B1A'],
  ['#A86AD1', '#5E2C85'],
  ['#E0805A', '#8F3B1E'],
  ['#4FB3A9', '#1D6A63'],
  ['#D4A93F', '#7E5E12'],
  ['#D86A9A', '#86294F'],
  ['#7C8BE0', '#36428F'],
];

export function tokenGradient(t: Token): [string, string] {
  if (t.native) return ['#2B5876', '#0E2233'];
  if (isWqrl(t)) return ['#4A90BF', '#23506E'];
  let h = 0;
  for (const ch of t.address.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

export function tokenGlyph(t: Token): string {
  if (t.native) return 'Q';
  if (isWqrl(t)) return 'W';
  return (t.symbol.match(/[A-Za-z0-9]/)?.[0] ?? '?').toUpperCase();
}
