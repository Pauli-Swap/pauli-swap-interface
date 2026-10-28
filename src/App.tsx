import { AccountDrawer, ConnectPanel, WrongNetworkModal } from './components/AccountDrawer';
import { Header } from './components/Header';
import { Banner } from './components/ui';
import { CHAIN } from './config';
import { navOf, useRoute } from './lib/router';
import { Explore } from './pages/Explore';
import { NewPosition } from './pages/NewPosition';
import { PoolDetail } from './pages/PoolDetail';
import { Positions } from './pages/Positions';
import { Predict } from './pages/Predict';
import { PredictMarket } from './pages/PredictMarket';
import { Swap } from './pages/Swap';
import { TokenDetail } from './pages/TokenDetail';
import { V2Position } from './pages/V2Position';
import { V3Position } from './pages/V3Position';
import { useApp } from './state/app';
import { useWallet } from './state/wallet';

export function App() {
  const route = useRoute();
  const { modalOpen, rpcError } = useApp();
  const { wrongNetwork, chainId } = useWallet();

  return (
    <div className="shell">
      <Header nav={navOf(route)} />
      {rpcError && (
        <div className="page-banners">
          <Banner tone="alert" title={`Cannot reach ${CHAIN.name}`}>
            The RPC did not answer. The devnet machine is stopped by default; start it with /flow start private-testnet.
          </Banner>
        </div>
      )}
      {route.page === 'swap' && <Swap />}
      {route.page === 'explore' && <Explore tab={route.tab} />}
      {route.page === 'token' && <TokenDetail address={route.address} key={route.address} />}
      {route.page === 'poolDetail' && <PoolDetail address={route.address} key={route.address} />}
      {route.page === 'positions' && <Positions />}
      {route.page === 'newPosition' && <NewPosition />}
      {route.page === 'v3pos' && <V3Position id={route.id} key={route.id} />}
      {route.page === 'v2pos' && <V2Position pair={route.pair} key={route.pair} />}
      {route.page === 'predict' && <Predict tab={route.tab} />}
      {route.page === 'predictMarket' && <PredictMarket id={route.id} key={route.id} />}
      {modalOpen === 'connect' && <ConnectPanel />}
      {modalOpen === 'account' && <AccountDrawer />}
      {wrongNetwork && <WrongNetworkModal key={chainId ?? 0} />}
    </div>
  );
}
