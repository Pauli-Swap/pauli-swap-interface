import { useEffect, useRef, useState } from 'react';
import { factory, pair, sameAddress } from '../lib/chain';
import { getPairState, PairState } from '../lib/pairs';
import { fetchTokenMetadata, Token } from '../lib/tokens';
import { useApp } from '../state/app';

export type Position = PairState & { token0Info: Token; token1Info: Token; balance: bigint };

function useTokenLookup() {
  const { tokens } = useApp();
  return async (address: string): Promise<Token> =>
    tokens.find((t) => !t.native && sameAddress(t.address, address)) ?? (await fetchTokenMetadata(address));
}

/// The account's V2 positions: every pair from the factory where it holds LP
/// tokens. Devnets carry a handful of pairs, so a full scan per block is cheap.
export function usePositions(account: string | null) {
  const { block, tokens } = useApp();
  const lookup = useTokenLookup();
  const pairsRef = useRef<string[]>([]);
  const [positions, setPositions] = useState<Position[] | null>(null);

  useEffect(() => {
    if (!account) {
      setPositions(null);
      return;
    }
    let alive = true;
    (async () => {
      const f = factory();
      const count = Number(await f.methods.allPairsLength().call());
      for (let i = pairsRef.current.length; i < Math.min(count, 500); i++) pairsRef.current.push(await f.methods.allPairs(i).call());
      const held = await Promise.all(
        pairsRef.current.map(async (address) => {
          const balance = BigInt(await pair(address).methods.balanceOf(account).call());
          if (balance === 0n) return null;
          const state = await getPairState(address);
          const [token0Info, token1Info] = await Promise.all([lookup(state.token0), lookup(state.token1)]);
          return { ...state, token0Info, token1Info, balance };
        }),
      );
      if (alive) setPositions(held.filter((p): p is Position => !!p));
    })().catch(() => alive && setPositions((p) => p ?? []));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, block, tokens]);

  return positions;
}

export function usePair(address: string | null | undefined, account: string | null) {
  const { block } = useApp();
  const lookup = useTokenLookup();
  const [state, setState] = useState<Position | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!address) return setState(null);
    let alive = true;
    (async () => {
      const s = await getPairState(address);
      const [token0Info, token1Info] = await Promise.all([lookup(s.token0), lookup(s.token1)]);
      const balance = account ? BigInt(await pair(address).methods.balanceOf(account).call()) : 0n;
      if (alive) {
        setState({ ...s, token0Info, token1Info, balance });
        setError(false);
      }
    })().catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, account, block]);
  return { pair: state, error };
}
