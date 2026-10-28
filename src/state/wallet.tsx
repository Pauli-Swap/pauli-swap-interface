import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { CHAIN } from '../config';
import { load, save } from '../lib/storage';

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<any>;
  on?: (event: string, listener: (...args: any[]) => void) => void;
  removeListener?: (event: string, listener: (...args: any[]) => void) => void;
};

export type ProviderDetail = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
};

type WalletState = {
  providers: ProviderDetail[];
  active: ProviderDetail | null;
  account: string | null;
  chainId: number | null;
  connecting: boolean;
  error: string | null;
  wrongNetwork: boolean;
  connect: (detail: ProviderDetail) => Promise<void>;
  disconnect: () => Promise<void>;
  switchChain: () => Promise<void>;
};

const WalletContext = createContext<WalletState | null>(null);
const LAST_WALLET_KEY = 'acorn.lastWallet';

const toChainId = (value: unknown) => (typeof value === 'string' ? parseInt(value, 16) : Number(value));

export function WalletProvider({ children }: { children: ReactNode }) {
  const [providers, setProviders] = useState<ProviderDetail[]>([]);
  const [active, setActive] = useState<ProviderDetail | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // EIP-6963 discovery; the QRL Web3 Wallet announces itself with rdns "theqrl.org".
  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<ProviderDetail>).detail;
      if (!detail?.info?.uuid) return;
      setProviders((list) => (list.some((p) => p.info.uuid === detail.info.uuid) ? list : [...list, detail]));
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
  }, []);

  // Silent reconnect: qrl_accounts returns the permitted accounts without a prompt.
  useEffect(() => {
    if (active) return;
    const last = load<string | null>(LAST_WALLET_KEY, null);
    const detail = providers.find((p) => p.info.rdns === last);
    if (!detail) return;
    (async () => {
      try {
        const accounts: string[] = await detail.provider.request({ method: 'qrl_accounts' });
        if (!accounts?.length) return;
        setActive(detail);
        setAccount(accounts[0]);
        setChainId(toChainId(await detail.provider.request({ method: 'qrl_chainId' })));
      } catch {
        /* the user connects manually */
      }
    })();
  }, [providers, active]);

  useEffect(() => {
    const p = active?.provider;
    if (!p?.on) return;
    const onAccounts = (accounts: string[]) => {
      if (!accounts?.length) {
        setActive(null);
        setAccount(null);
      } else setAccount(accounts[0]);
    };
    const onChain = (id: string) => setChainId(toChainId(id));
    p.on('accountsChanged', onAccounts);
    p.on('chainChanged', onChain);
    return () => {
      p.removeListener?.('accountsChanged', onAccounts);
      p.removeListener?.('chainChanged', onChain);
    };
  }, [active]);

  const connect = useCallback(async (detail: ProviderDetail) => {
    setConnecting(true);
    setError(null);
    try {
      const accounts: string[] = await detail.provider.request({ method: 'qrl_requestAccounts' });
      if (!accounts?.length) throw new Error('The wallet returned no accounts');
      setActive(detail);
      setAccount(accounts[0]);
      setChainId(toChainId(await detail.provider.request({ method: 'qrl_chainId' })));
      save(LAST_WALLET_KEY, detail.info.rdns);
    } catch (e: any) {
      setError(e?.code === 4001 ? 'Connection request rejected in the wallet' : e?.message ?? 'Could not connect');
      throw e;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await active?.provider.request({ method: 'wallet_revokePermissions', params: [{ qrl_accounts: {} }] });
    } catch {
      /* not every wallet supports revocation; local state is cleared anyway */
    }
    save(LAST_WALLET_KEY, null);
    setActive(null);
    setAccount(null);
    setChainId(null);
  }, [active]);

  const switchChain = useCallback(async () => {
    const p = active?.provider;
    if (!p) return;
    try {
      await p.request({ method: 'wallet_switchQRLChain', params: [{ chainId: CHAIN.hexId }] });
    } catch {
      await p.request({
        method: 'wallet_addQRLChain',
        params: [
          {
            chainId: CHAIN.hexId,
            chainName: CHAIN.name,
            rpcUrls: [CHAIN.walletRpcUrl],
            nativeCurrency: CHAIN.nativeCurrency,
            ...(CHAIN.explorerUrl ? { blockExplorerUrls: [CHAIN.explorerUrl] } : {}),
          },
        ],
      });
    }
    setChainId(toChainId(await p.request({ method: 'qrl_chainId' })));
  }, [active]);

  const value: WalletState = {
    providers,
    active,
    account,
    chainId,
    connecting,
    error,
    wrongNetwork: !!account && chainId !== null && chainId !== CHAIN.id,
    connect,
    disconnect,
    switchChain,
  };
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet outside WalletProvider');
  return ctx;
}
