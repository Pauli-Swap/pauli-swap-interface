import { useCallback, useEffect, useState } from 'react';
import { FAUCET } from '../config';
import faucetAbi from '../contracts/abi/QrlFaucet.json';
import { contract } from '../lib/chain';
import { formatAmount } from '../lib/format';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';

const faucet = () => contract(faucetAbi as any, FAUCET.address) as any;

const ERRORS: Record<string, string> = {
  'cooling-down': 'Already claimed today. The faucet pays once every 24 hours per wallet.',
  'ip-limit': 'This network has reached its faucet limit for today.',
  'faucet-empty': 'The faucet is empty. Ask the PauliSwap team to top it up.',
  denied: 'This wallet cannot use the faucet.',
  'bad-address': 'The faucet did not accept this address.',
};

/// The PauliSwap QRL faucet: a sponsored claim, so the wallet signs nothing
/// and needs no QRL for gas. `nextAt` is when the wallet may claim next
/// (0: now, undefined: loading or no faucet), read from the contract.
export function useQrlFaucet(account: string | null) {
  const { block } = useApp();
  const { notify } = useTx();
  const [nextAt, setNextAt] = useState<number | undefined>(undefined);
  const [claiming, setClaiming] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!FAUCET.deployed || !account) return setNextAt(undefined);
    let alive = true;
    faucet()
      .methods.nextClaimAt(account)
      .call()
      .then((v: bigint) => alive && setNextAt(Number(v)))
      .catch(() => alive && setNextAt(undefined));
    return () => {
      alive = false;
    };
  }, [account, block, nonce]);

  const amount = `${formatAmount(FAUCET.drip, 18, 0)} QRL`;

  const claim = useCallback(async () => {
    if (!account || claiming) return false;
    setClaiming(true);
    try {
      const res = await fetch(`${FAUCET.serviceUrl}/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: account }) });
      const body = (await res.json().catch(() => ({}))) as { hash?: string; error?: string; nextClaimAt?: number };
      if (res.ok && body.hash) {
        notify({ kind: 'success', title: `Received ${amount}`, sub: 'Test QRL from the PauliSwap faucet', hash: body.hash });
        return true;
      }
      if (body.nextClaimAt) setNextAt(body.nextClaimAt);
      notify({ kind: 'failed', title: 'Faucet claim failed', sub: ERRORS[body.error ?? ''] ?? 'The faucet service is offline. Try again in a minute.' });
      return false;
    } catch {
      notify({ kind: 'failed', title: 'Faucet claim failed', sub: 'The faucet service is offline. Try again in a minute.' });
      return false;
    } finally {
      setClaiming(false);
      setNonce((n) => n + 1);
    }
  }, [account, claiming, notify, amount]);

  return { available: FAUCET.deployed, nextAt, ready: nextAt === 0, claiming, claim, amount };
}
