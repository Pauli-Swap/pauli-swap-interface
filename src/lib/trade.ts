import { LP_FEE_BPS } from '../config';
import { factory, pair, quoter, router, sameAddress } from './chain';
import { toFloat } from './format';
import { getPairAddress, getPairState, orderedReserves } from './pairs';
import { PoolInfo } from './registry';
import { isNative, isWqrl, Token, wrappedAddress } from './tokens';
import { encodePath, feeLabel } from './v3';

export type TradeType = 'exactIn' | 'exactOut';

export type Route = { protocol: 'v2'; path: string[] } | { protocol: 'v3'; path: string[]; fees: number[] };

export type Trade = {
  kind: 'swap';
  type: TradeType;
  route: Route;
  /// Token addresses along the route, input first.
  path: string[];
  amountIn: bigint;
  amountOut: bigint;
  /// Price impact with the LP fee taken out, as the Figma "Price impact" row shows.
  priceImpact: number;
  executionPrice: number;
  lpFee: bigint;
  feeFraction: number;
};

export const routeLabel = (r: Route) =>
  r.protocol === 'v2' ? 'V2 · 0.3%' : `V3 · ${r.fees.map(feeLabel).join(' + ')}`;

export function wrapKind(input: Token, output: Token): 'wrap' | 'unwrap' | null {
  if (isNative(input) && isWqrl(output)) return 'wrap';
  if (isWqrl(input) && isNative(output)) return 'unwrap';
  return null;
}

type Edge = [string, string];
let graph: { count: number; edges: Edge[] } = { count: 0, edges: [] };

/// Pair graph from the factory, extended incrementally as pairs are created.
async function loadGraph(): Promise<Edge[]> {
  const f = factory();
  const count = Math.min(Number(await f.methods.allPairsLength().call()), 500);
  if (count > graph.count) {
    const fresh = await Promise.all(
      Array.from({ length: count - graph.count }, async (_, i) => {
        const address = await f.methods.allPairs(graph.count + i).call();
        const c = pair(address);
        const [t0, t1] = await Promise.all([c.methods.token0().call(), c.methods.token1().call()]);
        return [String(t0).toLowerCase(), String(t1).toLowerCase()] as Edge;
      }),
    );
    graph = { count, edges: [...graph.edges, ...fresh] };
  }
  return graph.edges;
}

/// Every simple path of at most `maxHops` pairs between the two tokens.
export async function candidatePaths(input: Token, output: Token, maxHops = 3): Promise<string[][]> {
  const a = wrappedAddress(input).toLowerCase();
  const b = wrappedAddress(output).toLowerCase();
  if (a === b) return [];
  const edges = await loadGraph();
  const neighbours = new Map<string, string[]>();
  for (const [x, y] of edges) {
    neighbours.set(x, [...(neighbours.get(x) ?? []), y]);
    neighbours.set(y, [...(neighbours.get(y) ?? []), x]);
  }
  const paths: string[][] = [];
  const walk = (node: string, path: string[]) => {
    if (path.length - 1 > maxHops) return;
    if (node === b) return void paths.push(path);
    for (const next of neighbours.get(node) ?? []) if (!path.includes(next)) walk(next, [...path, next]);
  };
  walk(a, [a]);
  return paths.sort((p, q) => p.length - q.length).slice(0, 12);
}

async function v2MidPrice(path: string[], decimals: number[]): Promise<number> {
  let price = 1;
  for (let i = 0; i < path.length - 1; i++) {
    const address = await getPairAddress(path[i], path[i + 1]);
    if (!address) return 0;
    const state = await getPairState(address);
    const [rIn, rOut] = orderedReserves(state, path[i]);
    price *= toFloat(rOut, decimals[i + 1]) / toFloat(rIn, decimals[i]);
  }
  return price;
}

function v3MidPrice(path: string[], fees: number[], pools: PoolInfo[], decimals: number[]): number {
  let price = 1;
  for (let i = 0; i < fees.length; i++) {
    const p = pools.find((x) => x.version === 'v3' && x.fee === fees[i] && ((sameAddress(x.token0, path[i]) && sameAddress(x.token1, path[i + 1])) || (sameAddress(x.token1, path[i]) && sameAddress(x.token0, path[i + 1]))));
    if (!p || !p.sqrtPriceX96) return 0;
    const s = Number(p.sqrtPriceX96) / 2 ** 96;
    const raw1per0 = s * s;
    const inIs0 = sameAddress(p.token0, path[i]);
    const rawOutPerIn = inIs0 ? raw1per0 : 1 / raw1per0;
    price *= rawOutPerIn * 10 ** (decimals[i] - decimals[i + 1]);
  }
  return price;
}

/// V3 routes of one or two hops through pools that hold liquidity.
function v3Candidates(a: string, b: string, pools: PoolInfo[]): { path: string[]; fees: number[] }[] {
  const live = pools.filter((p) => p.version === 'v3' && p.liquidity > 0n);
  const touching = (t: string) => live.filter((p) => sameAddress(p.token0, t) || sameAddress(p.token1, t));
  const other = (p: PoolInfo, t: string) => (sameAddress(p.token0, t) ? p.token1 : p.token0);
  const routes: { path: string[]; fees: number[] }[] = [];
  for (const p of touching(a)) {
    const mid = other(p, a);
    if (sameAddress(mid, b)) routes.push({ path: [a, b], fees: [p.fee] });
    else for (const q of touching(mid)) if (q !== p && sameAddress(other(q, mid), b)) routes.push({ path: [a, mid, b], fees: [p.fee, q.fee] });
  }
  return routes.slice(0, 12);
}

type Quoted = { route: Route; amountIn: bigint; amountOut: bigint };

async function quoteV2(input: Token, output: Token, type: TradeType, amount: bigint): Promise<Quoted[]> {
  const paths = await candidatePaths(input, output);
  const r = router();
  const quoted = await Promise.all(
    paths.map(async (path): Promise<Quoted | null> => {
      try {
        const raw = type === 'exactIn' ? await r.methods.getAmountsOut(amount, path).call() : await r.methods.getAmountsIn(amount, path).call();
        const amounts = raw.map((x: bigint | string) => BigInt(x));
        return { route: { protocol: 'v2', path }, amountIn: amounts[0], amountOut: amounts[amounts.length - 1] };
      } catch {
        return null;
      }
    }),
  );
  return quoted.filter((q): q is Quoted => !!q);
}

async function quoteV3(input: Token, output: Token, type: TradeType, amount: bigint, pools: PoolInfo[]): Promise<Quoted[]> {
  const a = wrappedAddress(input);
  const b = wrappedAddress(output);
  const q = quoter();
  const quoted = await Promise.all(
    v3Candidates(a, b, pools).map(async ({ path, fees }): Promise<Quoted | null> => {
      try {
        let other: bigint;
        if (fees.length === 1) {
          other = BigInt(
            type === 'exactIn'
              ? await q.methods.quoteExactInputSingle(path[0], path[1], fees[0], amount, 0).call()
              : await q.methods.quoteExactOutputSingle(path[0], path[1], fees[0], amount, 0).call(),
          );
        } else {
          other = BigInt(
            type === 'exactIn'
              ? await q.methods.quoteExactInput(encodePath(path, fees), amount).call()
              : await q.methods.quoteExactOutput(encodePath([...path].reverse(), [...fees].reverse()), amount).call(),
          );
        }
        const route: Route = { protocol: 'v3', path, fees };
        return type === 'exactIn' ? { route, amountIn: amount, amountOut: other } : { route, amountIn: other, amountOut: amount };
      } catch {
        return null;
      }
    }),
  );
  return quoted.filter((x): x is Quoted => !!x);
}

export async function quote(
  input: Token,
  output: Token,
  type: TradeType,
  amount: bigint,
  hopDecimals: (address: string) => number,
  pools: PoolInfo[] = [],
  protocols: { v2: boolean; v3: boolean } = { v2: true, v3: true },
): Promise<Trade | null> {
  if (amount === 0n) return null;
  // Best execution across V2 and V3 routes: most out for exact input, least in
  // for exact output. Routes without the liquidity revert and drop out.
  const all = [
    ...(protocols.v2 ? await quoteV2(input, output, type, amount) : []),
    ...(protocols.v3 ? await quoteV3(input, output, type, amount, pools) : []),
  ];
  const valid = all.filter((x) => x.amountIn > 0n && x.amountOut > 0n);
  if (!valid.length) return null;
  const best = valid.reduce((x, y) => (type === 'exactIn' ? (y.amountOut > x.amountOut ? y : x) : y.amountIn < x.amountIn ? y : x));

  const path = best.route.path;
  const decimals = path.map(hopDecimals);
  const mid = best.route.protocol === 'v2' ? await v2MidPrice(path, decimals) : v3MidPrice(path, best.route.fees, pools, decimals);
  const executionPrice = toFloat(best.amountOut, output.decimals) / toFloat(best.amountIn, input.decimals);
  const fees = best.route.protocol === 'v2' ? path.slice(1).map(() => LP_FEE_BPS * 100) : best.route.fees;
  const feeFraction = 1 - fees.reduce((acc, f) => acc * (1 - f / 1_000_000), 1);
  const rawImpact = mid > 0 ? 1 - executionPrice / mid : 0;
  return {
    kind: 'swap',
    type,
    route: best.route,
    path,
    amountIn: best.amountIn,
    amountOut: best.amountOut,
    priceImpact: Math.max(0, rawImpact - feeFraction),
    executionPrice,
    lpFee: (best.amountIn * BigInt(Math.round(feeFraction * 1_000_000))) / 1_000_000n,
    feeFraction,
  };
}

export const IMPACT_WARNING = 0.02;
export const IMPACT_HIGH = 0.1;
