import { useCallback } from 'react';
import { shortAddress } from '../lib/chain';
import { displaySymbol, Token } from '../lib/tokens';
import { useApp } from '../state/app';

export function useNames() {
  const { tokens, tokenByAddress } = useApp();
  const sym = useCallback((t: Token | null | undefined) => displaySymbol(t, tokens), [tokens]);
  const symOf = useCallback(
    (address: string | null | undefined) => {
      if (!address) return '';
      const t = tokenByAddress(address);
      return t ? displaySymbol(t, tokens) : shortAddress(address);
    },
    [tokens, tokenByAddress],
  );
  return { sym, symOf };
}
