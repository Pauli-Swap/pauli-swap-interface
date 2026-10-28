import { useQrlFaucet } from '../hooks/qrlFaucet';
import { span, useCountdown } from './predict';

/// "Get 50 test QRL": the sponsored PauliSwap faucet claim. While the wallet
/// is cooling down it shows the time left instead.
export function FaucetButton({ account, className = 'btn btn-sm btn-primary' }: { account: string | null; className?: string }) {
  const f = useQrlFaucet(account);
  const left = useCountdown(f.nextAt || undefined);
  if (!f.available || !account) return null;
  const cooling = !!f.nextAt && (left ?? 0) > 0;
  return (
    <button className={className} disabled={f.claiming || cooling || f.nextAt === undefined} onClick={f.claim} title="Sponsored claim: nothing to sign, no gas needed">
      {f.claiming ? 'Sending…' : cooling ? `Next claim in ${span(left!)}` : `Get ${f.amount}`}
    </button>
  );
}
