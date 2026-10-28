import { FaucetButton } from '../components/QrlFaucet';
import { SwapWidget } from '../components/SwapWidget';
import { FAUCET } from '../config';
import { useBalances } from '../hooks/chain';
import { NATIVE } from '../lib/tokens';
import { useWallet } from '../state/wallet';

/// Trade (105:2024): the swap widget alone in a centered 480px column.
export function Swap() {
  const { account } = useWallet();
  const qrl = useBalances([NATIVE], account)(NATIVE);
  return (
    <main className="page swap-page">
      <SwapWidget syncUrl />
      {FAUCET.deployed && account && qrl === 0n ? (
        <div className="row swap-caption" style={{ gap: 12, justifyContent: 'center' }}>
          <span>No QRL in this wallet yet.</span>
          <FaucetButton account={account} />
        </div>
      ) : (
        <p className="swap-caption">Trade QRL-native tokens on PauliSwap V2 and V3 pools.</p>
      )}
    </main>
  );
}
