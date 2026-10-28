import devnet from './contracts/devnet.json';
import predictDevnet from './contracts/predict-devnet.json';
import faucetDevnet from './contracts/faucet-devnet.json';

const PUBLIC_RPC = 'https://app.quantumark.fi/rpc/private-testnet';

export const CHAIN = {
  id: devnet.chainId,
  hexId: `0x${devnet.chainId.toString(16)}`,
  name: 'QRL Devnet',
  /// Where the dApp reads from: the same-origin /rpc proxy unless overridden.
  rpcUrl: (import.meta.env.VITE_RPC_URL as string | undefined) || `${window.location.origin}/rpc`,
  /// What the wallet is told to use in wallet_addQRLChain; it must be reachable
  /// from any site, so never the dApp's own proxy.
  walletRpcUrl: (import.meta.env.VITE_WALLET_RPC_URL as string | undefined) || PUBLIC_RPC,
  explorerUrl: (import.meta.env.VITE_EXPLORER_URL as string | undefined) || '',
  nativeCurrency: { name: 'QRL', symbol: 'QRL', decimals: 18 },
} as const;

export const ADDRESSES = devnet.contracts;

/// PauliSwap Predict (`npm run sync:predict`). Addresses are empty until the
/// contracts are deployed on this chain; the Predict pages then say so.
const predictContracts = predictDevnet.contracts as Partial<Record<'PauliPredictXP' | 'PredictMarket', string>>;
export const PREDICT = {
  xp: predictContracts.PauliPredictXP ?? '',
  market: predictContracts.PredictMarket ?? '',
  startBlock: predictDevnet.startBlock ?? 0,
  deployed: !!predictContracts.PauliPredictXP && !!predictContracts.PredictMarket && predictDevnet.chainId === devnet.chainId,
};

/// The PauliSwap QRL faucet (`npm run sync:predict`). Claims are sponsored: the
/// faucet service signs `claimFor`, so a wallet with no QRL can claim. The dev
/// server and nginx expose that service at /faucet on the dApp's own origin.
const faucetContracts = faucetDevnet.contracts as Partial<Record<'QrlFaucet', string>>;
export const FAUCET = {
  address: faucetContracts.QrlFaucet ?? '',
  drip: BigInt(faucetDevnet.dripPlanck || '0'),
  cooldownSeconds: faucetDevnet.cooldownSeconds,
  serviceUrl: (import.meta.env.VITE_FAUCET_URL as string | undefined) || `${window.location.origin}/faucet`,
  deployed: !!faucetContracts.QrlFaucet && faucetDevnet.chainId === devnet.chainId,
};

export const DEFAULT_SLIPPAGE_BPS = 50;
export const DEFAULT_DEADLINE_MIN = 20;
export const LP_FEE_BPS = 30;
export const MAX_UINT256 = (1n << 256n) - 1n;
export const MINIMUM_LIQUIDITY = 1000n;
