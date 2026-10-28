import { useCallback, useEffect, useState } from 'react';
import { ADDRESSES } from '../config';
import { contract, sameAddress } from '../lib/chain';
import { formatAmount } from '../lib/format';
import { Token, tokenKey } from '../lib/tokens';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { useNames } from './names';

const FAUCET_ABI = [
  { inputs: [], name: 'faucet', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'faucetAmount', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
];
const faucetOf = (address: string) => contract(FAUCET_ABI as any, address) as any;

/// Seeded devnet test tokens (ACRN, QUSD, STAR) expose a public faucet();
/// `amountOf` is undefined while probing and 0n for tokens without one.
export function useFaucets() {
  const { tokens } = useApp();
  const { send } = useTx();
  const { sym } = useNames();
  const [amounts, setAmounts] = useState<Record<string, bigint>>({});

  useEffect(() => {
    tokens.forEach((t) => {
      if (t.native || sameAddress(t.address, ADDRESSES.WQRL) || amounts[tokenKey(t)] !== undefined) return;
      faucetOf(t.address)
        .methods.faucetAmount()
        .call()
        .then((v: bigint) => setAmounts((m) => ({ ...m, [tokenKey(t)]: BigInt(v) })))
        .catch(() => setAmounts((m) => ({ ...m, [tokenKey(t)]: 0n })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);

  const amountOf = useCallback((t: Token) => (t.native || sameAddress(t.address, ADDRESSES.WQRL) ? 0n : amounts[tokenKey(t)]), [amounts]);
  const faucetTokens = tokens.filter((t) => (amountOf(t) ?? 0n) > 0n);

  const claim = useCallback(
    (t: Token) =>
      send({
        title: `Get test ${sym(t)}`,
        verb: 'faucet claim',
        activity: 'Claimed from faucet',
        successTitle: 'Tokens received',
        summary: { from: { token: t, amount: amounts[tokenKey(t)] ?? 0n, label: sym(t) } },
        build: () => ({ to: t.address, method: faucetOf(t.address).methods.faucet() }),
      }),
    [send, sym, amounts],
  );

  return { amountOf, claim, faucetTokens, formatFaucet: (t: Token) => formatAmount(amounts[tokenKey(t)], t.decimals) };
}
