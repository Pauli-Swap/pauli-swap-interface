import { useEffect, useState } from 'react';
import { nativeBalance, token as tokenContract } from '../lib/chain';
import { Token, tokenKey } from '../lib/tokens';
import { useApp } from '../state/app';

/// Balances for a set of tokens, refreshed on every new block.
export function useBalances(tokens: (Token | null | undefined)[], account: string | null) {
  const { block } = useApp();
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const keys = tokens.filter(Boolean).map((t) => tokenKey(t!)).sort().join(',');

  useEffect(() => {
    if (!account) {
      setBalances({});
      return;
    }
    let alive = true;
    const list = tokens.filter((t): t is Token => !!t);
    Promise.all(
      list.map(async (t) => {
        try {
          const value = t.native ? await nativeBalance(account) : BigInt(await tokenContract(t.address).methods.balanceOf(account).call());
          return [tokenKey(t), value] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!alive) return;
      setBalances((prev) => {
        const next = { ...prev };
        for (const e of entries) if (e) next[e[0]] = e[1];
        return next;
      });
    });
    return () => {
      alive = false;
    };
    // `keys` stands in for the token list identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, account, block]);

  return (t: Token | null | undefined) => (t ? balances[tokenKey(t)] : undefined);
}

/// SQRC-TF1 allowance of `owner` toward `spender`; native QRL never needs one.
export function useAllowance(tokenAddress: string | null, owner: string | null, spender: string) {
  const { block } = useApp();
  const [allowance, setAllowance] = useState<bigint | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!tokenAddress || !owner) {
      setAllowance(undefined);
      return;
    }
    let alive = true;
    tokenContract(tokenAddress)
      .methods.allowance(owner, spender)
      .call()
      .then((v: bigint) => alive && setAllowance(BigInt(v)))
      .catch(() => alive && setAllowance(undefined));
    return () => {
      alive = false;
    };
  }, [tokenAddress, owner, spender, block, nonce]);
  return { allowance, refresh: () => setNonce((n) => n + 1) };
}
