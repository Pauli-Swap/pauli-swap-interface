import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_DEADLINE_MIN, DEFAULT_SLIPPAGE_BPS } from '../config';
import { blockClock, reader, sameAddress } from '../lib/chain';
import { blockTimes } from '../lib/history';
import { loadPools, PoolInfo, poolTokens, qrlPrices } from '../lib/registry';
import { load, save } from '../lib/storage';
import { discoverTokens, NATIVE, Token, wrappedAddress } from '../lib/tokens';

export type Settings = { slippageBps: number; slippageAuto: boolean; deadlineMin: number; useV2: boolean; useV3: boolean };
const DEFAULT_SETTINGS: Settings = { slippageBps: DEFAULT_SLIPPAGE_BPS, slippageAuto: true, deadlineMin: DEFAULT_DEADLINE_MIN, useV2: true, useV3: true };
export type Clock = { latest: number; latestTime: number; secondsPerBlock: number };

type AppState = {
  block: number;
  rpcError: string | null;
  tokens: Token[];
  tokensLoading: boolean;
  refreshTokens: () => void;
  pools: PoolInfo[];
  poolsLoaded: boolean;
  /// Price of a token in QRL, through the deepest pools; undefined when no
  /// route reaches WQRL.
  priceInQrl: (t: Token | string | null | undefined) => number | undefined;
  tokenByAddress: (address: string) => Token | undefined;
  decimalsOf: (address: string) => number;
  clock: Clock;
  /// Approximate unix time of a block, interpolated from the block clock.
  blockTime: (block: number) => number;
  settings: Settings;
  setSettings: (s: Settings) => void;
  modalOpen: 'connect' | 'account' | null;
  openModal: (m: 'connect' | 'account' | null) => void;
};

const AppContext = createContext<AppState | null>(null);
const SETTINGS_KEY = 'acorn.settings';

export function AppProvider({ children }: { children: ReactNode }) {
  const [block, setBlock] = useState(0);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<Token[]>([NATIVE]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [poolsLoaded, setPoolsLoaded] = useState(false);
  const [clock, setClock] = useState<Clock>({ latest: 0, latestTime: Date.now() / 1000, secondsPerBlock: 13 });
  const [settings, setSettingsState] = useState<Settings>(() =>
    ({ ...DEFAULT_SETTINGS, ...load<Partial<Settings>>(SETTINGS_KEY, {}) }),
  );
  const [modalOpen, openModal] = useState<'connect' | 'account' | null>(null);
  const loading = useRef(false);
  const tokenCount = useRef(0);

  // Everything chain-derived refetches when this number moves.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const n = Number(await reader.qrl.getBlockNumber());
        if (!alive) return;
        setRpcError(null);
        setBlock((b) => (b === n ? b : n));
      } catch (e) {
        if (alive) setRpcError((e as Error).message || 'RPC unreachable');
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const refreshTokens = useCallback((addresses?: string[]) => {
    setTokensLoading(true);
    discoverTokens(addresses ?? [])
      .then(setTokens)
      .catch(() => undefined)
      .finally(() => setTokensLoading(false));
  }, []);

  useEffect(() => {
    if (!block || loading.current) return;
    loading.current = true;
    loadPools(block)
      .then((list) => {
        setPools(list);
        setPoolsLoaded(true);
        const addresses = poolTokens(list);
        if (addresses.length !== tokenCount.current) {
          tokenCount.current = addresses.length;
          refreshTokens(addresses);
        }
      })
      .catch(() => undefined)
      .finally(() => (loading.current = false));
    if (block - clock.latest > 20 || clock.latest === 0) blockClock().then(setClock).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block]);

  const tokenByAddress = useCallback((address: string) => tokens.find((t) => !t.native && sameAddress(t.address, address)), [tokens]);
  const decimalsOf = useCallback((address: string) => tokenByAddress(address)?.decimals ?? 18, [tokenByAddress]);
  const prices = useMemo(() => qrlPrices(pools, decimalsOf), [pools, decimalsOf]);
  const priceInQrl = useCallback(
    (t: Token | string | null | undefined) => {
      if (!t) return undefined;
      const address = typeof t === 'string' ? t : wrappedAddress(t);
      return prices.get(address.toLowerCase());
    },
    [prices],
  );
  const blockTime = useCallback(
    (n: number) => blockTimes.get(n) ?? clock.latestTime - (clock.latest - n) * clock.secondsPerBlock,
    [clock],
  );

  const setSettings = (s: Settings) => {
    setSettingsState(s);
    save(SETTINGS_KEY, s);
  };

  return (
    <AppContext.Provider
      value={{
        block,
        rpcError,
        tokens,
        tokensLoading,
        refreshTokens: () => refreshTokens(poolTokens(pools)),
        pools,
        poolsLoaded,
        priceInQrl,
        tokenByAddress,
        decimalsOf,
        clock,
        blockTime,
        settings,
        setSettings,
        modalOpen,
        openModal,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside AppProvider');
  return ctx;
}
