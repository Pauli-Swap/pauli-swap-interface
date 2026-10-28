import { Web3 } from '@theqrl/web3';
import factoryAbi from '../contracts/abi/PauliV2Factory.json';
import pairAbi from '../contracts/abi/PauliV2Pair.json';
import routerAbi from '../contracts/abi/PauliV2Router02.json';
import tokenAbi from '../contracts/abi/SQRCTF1.json';
import wqrlAbi from '../contracts/abi/WQRL.json';
import v3FactoryAbi from '../contracts/abi/PauliV3Factory.json';
import v3PoolAbi from '../contracts/abi/PauliV3Pool.json';
import swapRouterAbi from '../contracts/abi/SwapRouter.json';
import quoterAbi from '../contracts/abi/Quoter.json';
import npmAbi from '../contracts/abi/NonfungiblePositionManager.json';
import tickLensAbi from '../contracts/abi/TickLens.json';
import predictXpAbi from '../contracts/abi/PauliPredictXP.json';
import predictMarketAbi from '../contracts/abi/PredictMarket.json';
import { ADDRESSES, CHAIN, PREDICT } from '../config';
import { BatchProvider } from './rpc';

export const ABI = {
  factory: factoryAbi,
  pair: pairAbi,
  router: routerAbi,
  token: tokenAbi,
  wqrl: wqrlAbi,
  v3Factory: v3FactoryAbi,
  v3Pool: v3PoolAbi,
  swapRouter: swapRouterAbi,
  quoter: quoterAbi,
  npm: npmAbi,
  tickLens: tickLensAbi,
  predictXP: predictXpAbi,
  predictMarket: predictMarketAbi,
};
type Abi = (typeof ABI)[keyof typeof ABI];

type Method = {
  call: (options?: object) => Promise<any>;
  estimateGas: (options?: object) => Promise<bigint>;
  send: (options: object) => PromiseLike<any> & { on: (event: string, cb: (value: any) => void) => any };
};
/// The generated Contract typings are too deep for these ABIs to be useful;
/// call sites go through this narrow shape instead.
export type AnyContract = { methods: Record<string, (...args: any[]) => Method> };

/// Reads always go straight to the RPC so they work before a wallet connects
/// and do not depend on the chain the wallet is pointed at.
export const reader = new Web3(new BatchProvider(CHAIN.rpcUrl) as any);

export function contract(abi: Abi, address: string, web3: Web3 = reader): AnyContract {
  return new web3.qrl.Contract(abi as any, address) as unknown as AnyContract;
}

export const factory = () => contract(ABI.factory, ADDRESSES.PauliV2Factory);
export const router = (web3?: Web3) => contract(ABI.router, ADDRESSES.PauliV2Router02, web3);
export const token = (address: string, web3?: Web3) => contract(ABI.token, address, web3);
export const pair = (address: string, web3?: Web3) => contract(ABI.pair, address, web3);
export const wqrl = (web3?: Web3) => contract(ABI.wqrl, ADDRESSES.WQRL, web3);
export const v3Factory = () => contract(ABI.v3Factory, ADDRESSES.PauliV3Factory);
export const v3Pool = (address: string) => contract(ABI.v3Pool, address);
export const swapRouter = () => contract(ABI.swapRouter, ADDRESSES.SwapRouter);
export const quoter = () => contract(ABI.quoter, ADDRESSES.Quoter);
export const positionManager = () => contract(ABI.npm, ADDRESSES.NonfungiblePositionManager);
export const tickLens = () => contract(ABI.tickLens, ADDRESSES.TickLens);
export const predictXP = () => contract(ABI.predictXP, PREDICT.xp);
export const predictMarket = () => contract(ABI.predictMarket, PREDICT.market);

/// Average seconds per block over the last `span` blocks, for turning block
/// numbers into approximate times without fetching every block.
export async function blockClock(span = 200): Promise<{ latest: number; latestTime: number; secondsPerBlock: number }> {
  const latest = Number(await reader.qrl.getBlockNumber());
  const from = Math.max(1, latest - span);
  const [a, b] = await Promise.all([reader.qrl.getBlock(from), reader.qrl.getBlock(latest)]);
  const dt = Number(b.timestamp) - Number(a.timestamp);
  return { latest, latestTime: Number(b.timestamp), secondsPerBlock: latest > from && dt > 0 ? dt / (latest - from) : 13 };
}

export const ZERO_ADDRESS = 'Q' + '0'.repeat(128);
export const isZero = (address: string) => /^Q0+$/i.test(address);
export const sameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const isQAddress = (value: string) => /^Q[0-9a-fA-F]{128}$/.test(value.trim());
export const shortAddress = (address: string, size = 4) => `${address.slice(0, size + 1)}…${address.slice(-size)}`;

export async function nativeBalance(address: string): Promise<bigint> {
  return BigInt(await reader.qrl.getBalance(address));
}

export async function waitForReceipt(hash: string, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = await reader.qrl.getTransactionReceipt(hash).catch(() => null);
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Timed out waiting for the transaction to be mined');
}
