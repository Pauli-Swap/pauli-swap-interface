# PauliSwap Interface

Web front end for [PauliSwap](../pauli-swap) V2 and V3 on the private QRL
devnet (QIP-55, `chainId` 3151908). The UI follows the Swap, Explore, Pool,
Prediction Market and Wallet pages of the PauliSwap Figma file (`oOPY8foOfB8hWept1yzgAC`): Quantum
Color theme (obsidian ramp, quantum blue, QRL orange for QRL marks), Poppins,
72px header and a 1120px content column. Every number on screen is read from the
chain; nothing is mocked.

## Run

```
npm install
npm run dev                  # http://localhost:5180
```

The browser reads the chain through `/rpc` on the dApp's own origin; the dev
and preview servers forward it to `https://app.quantumark.fi/rpc/private-testnet`
(`RPC_PROXY_TARGET`). The public endpoint answers POSTs with a duplicated
`Access-Control-Allow-Origin` header, which browsers refuse, and a same-origin
request is never subject to CORS. Whatever serves `dist/` in production needs
the same forward, e.g. in nginx:

```nginx
location = /rpc {
  proxy_pass https://app.quantumark.fi/rpc/private-testnet;
  proxy_ssl_server_name on;
}
```

The devnet machine is stopped by default (`/flow start private-testnet`).

Optional: with `VITE_INDEXER_URL` set (see `.env.example`), history, pool
discovery, holder counts and transaction senders come from
`pauli-swap-indexer` instead of log scans; the newest unindexed blocks, and
everything when the indexer is down or lags, still come from RPC.

Install the **QRL Web3 Wallet** extension. The app finds it via EIP-6963
(`rdns: theqrl.org`); MetaMask cannot sign ML-DSA-87 transactions. If the
wallet is on another chain, the app offers `wallet_switchQRLChain`, then
`wallet_addQRLChain` with the RPC above.

## What it does

| Route | What it shows |
| --- | --- |
| `#/swap` | Swap / Wrap widget. V2 `getAmountsOut` / `getAmountsIn` and V3 `Quoter` routes (each protocol can be switched off in settings); the better quote wins. Both execute through `SwapRouter02` in one `multicall(deadline, …)`, which also takes the interface fee (below); a deployment without `SwapRouter02` falls back to `PauliV2Router02` / `SwapRouter` and no fee. Wrap and unwrap call `WQRL`. |
| `#/explore`, `/pools`, `/transactions` | Network stats, Tokens / Pools / Transactions tables built from pool state and `Swap` / `Sync` / `Mint` / `Burn` logs; the wallet column is the transaction sender. |
| `#/explore/tokens/:address` (or `QRL`) | Price, volume and TVL charts, stats (holders from `Transfer` logs), faucet, swap widget, pools with the token. |
| `#/explore/pools/:address` | Pool price / volume / liquidity charts, balances, fee APR, contracts, transactions. |
| `#/pool` | The wallet's V2 LP and V3 position NFTs, plus the top pools by TVL. |
| `#/pool/new?version=v3\|v2&tokenA=&tokenB=&fee=` | New V3 position (pair and fee tier, then range on the `TickLens` histogram and deposit; `createAndInitializePoolIfNecessary` + `mint`) or V2 deposit (`addLiquidity(QRL)`). |
| `#/pool/v3/:id` | V3 position: range chart, liquidity, unclaimed fees; `collect`, `increaseLiquidity`, and remove (`decreaseLiquidity` + `collect` (+ unwrap / sweep, + `burn`) in one `multicall`). |
| `#/pool/v2/:pair` | V2 position: share, LP tokens, value history from `Sync` logs, `removeLiquidity(QRL)`. |
| `#/predict`, `/quests`, `/leaderboard`, `/rewards` | PauliSwap Predict: markets table (price from `PredictMarket.markets`, 24h change and volume replayed from `Bought` / `Sold`), daily check-in (`PauliPredictXP.checkIn`), daily quests and season milestones with progress from the indexer (`questProgress`), a get-started panel with the test QRL faucet, season ranking rebuilt from `XPCredited` / `XPDebited`, prizes. |
| `#/predict/market/:id` | Yes price chart, stats, buy / sell (`buy` / `sell` with slippage bounds on shares), claim after resolve or cancel. |
| Owner tools | Only for the wallet that is `PredictMarket.owner()` on chain: New market in the Markets bar (`createMarket`, close time in UTC, at most `seasonEndsAt`), and on the market page Resolve Yes / No once `closeTime` has passed (`resolve`) and Cancel (`cancel`). |

Predict reads `src/contracts/predict-devnet.json`, written by
`npm run sync:predict` from `../pauli-swap-prediction-market` (ABIs from
`build/qrvm`, addresses from `deployments/devnet.json`). Without addresses in
that file the Predict pages say Predict is not deployed.
Where the contracts differ from the Figma screens, the pages follow the
contracts: a winning share pays 1 XP (not 100), markets are Yes / No only, and
there are no categories or rule texts on chain. Quests other than the
check-in are credited by the attester bot (`npm run attester` in that repo,
one tick a minute on the VPS) and appear once credited.

Every token spend needs an explicit `approve` first: Zond has no `ecrecover`, so
the permit paths are gone. V2 spends go to `PauliV2Router02`, V3 swaps to
`SwapRouter`, and V3 liquidity to `NonfungiblePositionManager`. Each write is gas
estimated before the wallet prompt, which surfaces revert reasons
(`PauliV2Router: EXPIRED`, `Too little received`, `Price slippage check`, …)
up front.

## Devnet specifics

- **Addresses are 64 bytes** (`Q` + 128 hex) and ABI words are 64 bytes.
  Generic EVM libraries (ethers, viem) encode 32 byte words and cannot talk to
  these contracts; the app uses `@theqrl/web3` 1.0.3, the same version as the
  wallet.
- **Pair addresses are looked up**, never derived: QIP-55 CREATE2 is Keccak-512
  over a domain tag (`pauli-swap/docs/QRVM.md`, Q1). `factory.getPair` is the
  only source.
- **Event logs need 64 byte topics.** The node stores the keccak256 event
  signature right padded to 64 bytes, but `@theqrl/web3` 1.0.3 builds (and
  validates) 32 byte topic filters, which the node rejects. `src/lib/logs.ts`
  builds the filter itself and calls `qrl_getLogs` directly; only decoding goes
  through web3.
- **V3 pool addresses are looked up** through `PoolCreated` logs and
  `factory.getPool`, for the same Keccak-512 reason.
- **Times are approximate.** Charts place blocks on a clock interpolated from
  the average block time (about 13 s on the devnet) instead of fetching every
  block. Windows longer than the chain's history are clamped to the
  deployment block, and fee APR is only shown once a window covers an hour.
- **Token list** is everything that sits in a pair or V3 pool, plus WQRL and user imports
  (paste a Q address in the token selector). Several devnet test tokens report
  the same symbol, so ambiguous symbols get a short address suffix.
- **The devnet regenerates from genesis.** After a redeploy run
  `npm run sync:contracts`; it copies the QRVM ABIs and `deployments/devnet.json`
  from `../pauli-swap` into `src/contracts/`.

To seed an empty devnet with test tokens (ACRN, QUSD, STAR, each with a public
`faucet()`), V2 pairs, V3 pools with positions and some swap history, run
`node scripts/devnet/seed.cjs ../pauli-swap` with the pauli-swap `.env.devnet`
and its SSH tunnel in place. `scripts/devnet/DevnetToken.hyp` is the token
source; it keeps its address keyed mappings private behind explicit views
because QRVM public mapping getters read the wrong slot.

Swap state can be deep linked:
`#/swap?inputCurrency=QRL&outputCurrency=Q…&exactAmount=1&exactField=output`.

### Interface fee

Like Uniswap's interface, this front end keeps 0.25% of a swap's output for
the PauliSwap treasury (`src/lib/fee.ts`). The swap pays the router, and
`sweepTokenWithFee` / `unwrapWQRL9WithFee` split the output in the same
transaction. An exact output swap is quoted for the gross amount, so the
wallet still receives what was typed. The details and the review show the fee
as its own row. Wrap and unwrap are free, and so is any swap sent to the
contracts directly: those pay only the pool's LP fee.
`VITE_INTERFACE_FEE_BIPS` (0 turns it off, at most 100) and
`VITE_INTERFACE_FEE_RECIPIENT` override the defaults in `src/config.ts`.

`npm test` runs the unit tests in `tests/`: the V3 math against the vectors
the devnet audit recorded (`tests/fixtures/v3-vectors.json`, from
`pauli-swap/docs/onchain/devnet.differential.json`) and the fee arithmetic.

### Test QRL faucet

`#/predict/quests`, the account drawer and the swap page offer test QRL
from the PauliSwap faucet (`QrlFaucet`, synced by `npm run sync:predict`).
The claim is sponsored: the browser posts to `/faucet/claim` on its own
origin, the faucet service (`pauli-swap-prediction-market`, `npm run
faucet`) signs `claimFor`, and the wallet signs nothing. The dev and preview
servers forward `/faucet` to `FAUCET_PROXY_TARGET`; in production:

```nginx
location /faucet/ {
  proxy_pass http://127.0.0.1:8548;
  proxy_set_header X-Forwarded-For $remote_addr;
}
```

with `FAUCET_TRUSTED_PROXY=127.0.0.1` on the service so its per-IP limit sees
the visitor. Quest progress comes from the indexer (`VITE_INDEXER_URL`).

## Layout

```
src/
  config.ts            chain + contract addresses (from src/contracts/devnet.json)
  contracts/           synced QRVM ABIs (V2 and V3) and deployment
  lib/                 chain access, pool registry, logs, history, V2/V3 routing,
                       V3 tick and liquidity math, router, formatting
  hooks/               balances/allowances, market stats, V3 positions, names
  state/               wallet (EIP-6963), app data (block, pools, prices, settings), tx flow
  components/          header, UI kit (ui.tsx), charts, swap widget, tables, wallet overlays, modals
  pages/               Swap, Explore, TokenDetail, PoolDetail, Positions, NewPosition, V3Position, V2Position, Predict, PredictMarket
  styles/              tokens.css (Figma variables and text styles), app.css (shared components), one sheet per page group
```

## License

Copyright (C) 2026 PauliSwap. Written for PauliSwap from scratch and released
under the GNU General Public License v3.0 or later; see [LICENSE](LICENSE).
