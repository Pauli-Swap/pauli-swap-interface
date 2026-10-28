// Seeds the PauliSwap devnet for FE testing: named test tokens, V2 pairs, V3
// pools with positions, and a few swaps for history. Uses the pauli-swap
// deployer from its .env.devnet through that repo's own Chain helper, so the
// RPC is whatever that file points at (the SSH tunnel on 127.0.0.1:8545).
// Re-running resumes from seed-result.json; delete it after a devnet reset.
//   node scripts/devnet/seed.cjs [path/to/pauli-swap]
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..', 'pauli-swap'));
process.chdir(REPO);
const { loadEnv, Chain, artifact } = require(path.join(REPO, 'scripts/qrvm/lib.js'));
const dep = require(path.join(REPO, 'deployments/devnet.json')).contracts;
const tokenArt = require(path.join(__dirname, 'DevnetToken.json'));
const out = path.join(__dirname, 'seed-result.json');
const E18 = 10n ** 18n;
const MAX = (1n << 256n) - 1n;
const deadline = () => Math.floor(Date.now() / 1000) + 1800;
const lower = (a) => a.toLowerCase();
const sortPair = (a, b) => (BigInt('0x' + lower(a).slice(1)) < BigInt('0x' + lower(b).slice(1)) ? [a, b] : [b, a]);
const isqrt = (n) => { if (n < 2n) return n; let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; };
const sqrtPriceX96 = (raw1, raw0) => isqrt((raw1 << 192n) / raw0);
const tickOf = (price) => Math.floor(Math.log(price) / Math.log(1.0001));
const snap = (t, s) => Math.floor(t / s) * s;

async function main() {
  const chain = await new Chain(loadEnv()).init();
  // The node sometimes reports a stale pending nonce right after a receipt;
  // waiting one block and resending clears it.
  const rawSend = chain.send.bind(chain);
  chain.send = async (tx) => {
    for (let attempt = 0; ; attempt++) {
      try { return await rawSend(tx); } catch (e) {
        if (attempt < 6 && /underpriced|nonce too low|already known/i.test(String(e.message || e))) { await new Promise((r) => setTimeout(r, 15000)); continue; }
        throw e;
      }
    }
  };
  const me = chain.address;
  console.log('deployer', me, 'balance', Number((await chain.balance(me)) / 10n ** 15n) / 1000, 'QRL');
  const state = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
  const save = () => fs.writeFileSync(out, JSON.stringify(state, null, 2));
  const tokenAt = (a) => { const c = new chain.web3.qrl.Contract(tokenArt.abi, a); c.label = 'token'; return c; };

  for (const [sym, name, dec, supply, faucet] of [['ACRN', 'Pauli Token', 18, 10_000_000n, 1000n], ['QUSD', 'Quantum USD', 6, 10_000_000n, 10_000n], ['STAR', 'Starlight', 18, 1_000_000n, 100n]]) {
    if (state[sym]) continue;
    const unit = 10n ** BigInt(dec);
    const data = new chain.web3.qrl.Contract(tokenArt.abi).deploy({ data: tokenArt.bytecode, arguments: [name, sym, dec, supply * unit, faucet * unit] }).encodeABI();
    state[sym] = await chain.deployCode(data, sym);
    console.log(sym, state[sym]); save();
  }
  const T = { WQRL: dep.WQRL, ACRN: state.ACRN, QUSD: state.QUSD, STAR: state.STAR };
  const router2 = chain.at('PauliV2Router02', dep.PauliV2Router02);
  const swapRouter = chain.at('SwapRouter', dep.SwapRouter);
  const npm = chain.at('NonfungiblePositionManager', dep.NonfungiblePositionManager);
  const factory3 = chain.at('PauliV3Factory', dep.PauliV3Factory);

  if (!state.approved) {
    for (const sym of ['ACRN', 'QUSD', 'STAR']) for (const spender of [dep.PauliV2Router02, dep.SwapRouter, dep.NonfungiblePositionManager]) await chain.tx(tokenAt(T[sym]), 'approve', [spender, MAX]);
    state.approved = true; save(); console.log('approved');
  }
  if (!state.v2) {
    await chain.tx(router2, 'addLiquidityQRL', [T.ACRN, 400n * E18, 0, 0, me, deadline()], { value: 8n * E18 });
    await chain.tx(router2, 'addLiquidity', [T.ACRN, T.QUSD, 5000n * E18, 2500n * 10n ** 6n, 0, 0, me, deadline()]);
    state.v2 = true; save(); console.log('v2 pairs added');
  }

  // V3 pools: [tokenX, amountX, tokenY, amountY, fee, spacing, ranges as fractions around price]
  const pools = [
    ['QRL/ACRN 0.05%', 'WQRL', 6n * E18, 'ACRN', 303n * E18, 500, 10, [[0.9, 1.1], [0.5, 2.0]]],
    ['QUSD/STAR 0.3%', 'QUSD', 2000n * 10n ** 6n, 'STAR', 1000n * E18, 3000, 60, [[0.6, 1.6]]],
    ['QRL/QUSD 1%', 'WQRL', 3n * E18, 'QUSD', 75n * 10n ** 6n, 10000, 200, [[0.7, 1.4]]],
  ];
  state.v3 = state.v3 || {};
  for (const [label, xs, ax, ys, ay, fee, spacing, ranges] of pools) {
    if (state.v3[label]) continue;
    const [t0, t1] = sortPair(T[xs], T[ys]);
    const flip = lower(t0) !== lower(T[xs]);
    const [a0, a1] = flip ? [ay, ax] : [ax, ay];
    const price = Number(a1) / Number(a0);
    await chain.tx(npm, 'createAndInitializePoolIfNecessary', [t0, t1, fee, sqrtPriceX96(a1, a0)]);
    const pool = await chain.call(factory3, 'getPool', t0, t1, fee);
    const tokenIds = [];
    for (const [lo, hi] of ranges) {
      const tickLower = snap(tickOf(price * lo), spacing), tickUpper = snap(tickOf(price * hi), spacing) + spacing;
      const share = BigInt(ranges.length);
      const p = [t0, t1, fee, tickLower, tickUpper, a0 / share, a1 / share, 0, 0, me, deadline()];
      const native = lower(t0) === lower(T.WQRL) ? a0 / share : lower(t1) === lower(T.WQRL) ? a1 / share : 0n;
      if (native) {
        const calls = [npm.methods.mint(p).encodeABI(), npm.methods.refundQRL().encodeABI()];
        await chain.tx(npm, 'multicall', [calls], { value: native });
      } else await chain.tx(npm, 'mint', [p]);
      tokenIds.push(Number(await chain.call(npm, 'totalSupply')));
    }
    state.v3[label] = { pool, fee, token0: t0, token1: t1, tokenIds }; save();
    console.log('v3', label, pool, 'positions', tokenIds.join(','));
  }

  if (!state.swaps) {
    for (let i = 0; i < 4; i++) {
      await chain.tx(router2, 'swapExactQRLForTokens', [0, [T.WQRL, T.ACRN], me, deadline()], { value: (1n + BigInt(i)) * E18 / 4n });
      await chain.tx(router2, 'swapExactTokensForQRL', [(8n + BigInt(i) * 3n) * E18, 0, [T.ACRN, T.WQRL], me, deadline()]);
      await chain.tx(swapRouter, 'exactInputSingle', [[T.WQRL, T.ACRN, 500, me, deadline(), E18 / (4n + BigInt(i)), 0, 0]], { value: E18 / (4n + BigInt(i)) });
      await chain.tx(swapRouter, 'exactInputSingle', [[T.ACRN, T.WQRL, 500, me, deadline(), (6n + BigInt(i) * 2n) * E18, 0, 0]]);
      await chain.tx(swapRouter, 'exactInputSingle', [[T.QUSD, T.STAR, 3000, me, deadline(), (40n + BigInt(i) * 15n) * 10n ** 6n, 0, 0]]);
      await chain.tx(router2, 'swapExactTokensForTokens', [(50n + BigInt(i) * 10n) * E18, 0, [T.ACRN, T.QUSD], me, deadline()]);
    }
    state.swaps = true; save(); console.log('swaps done');
  }
  console.log('balance after', Number((await chain.balance(me)) / 10n ** 15n) / 1000, 'QRL');
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
