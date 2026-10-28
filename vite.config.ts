import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, ProxyOptions } from 'vite';

const PUBLIC_RPC = 'https://app.quantumark.fi/rpc/private-testnet';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // The public endpoint answers POSTs with a duplicated Access-Control-Allow-Origin
  // header, which browsers reject. Reads go through this same-origin path
  // instead, where CORS never applies, so neither the origin IP nor a change
  // to the endpoint is needed.
  const rpcProxy: Record<string, ProxyOptions> = {
    '/rpc': {
      target: env.RPC_PROXY_TARGET || PUBLIC_RPC,
      changeOrigin: true,
      secure: true,
      rewrite: () => '',
    },
    // The PauliSwap faucet service (pauli-swap-prediction-market `npm run
    // faucet`), which signs sponsored claims; same origin, like /rpc.
    '/faucet': {
      target: env.FAUCET_PROXY_TARGET || 'http://127.0.0.1:8548',
      changeOrigin: true,
    },
  };
  return {
    plugins: [react()],
    // @theqrl/web3 still touches Node's `global`, `events` and `buffer` from its
    // web3.js ancestry; the QRL Web3 Wallet extension aliases them the same way.
    define: { global: 'globalThis' },
    resolve: { alias: { events: 'events', buffer: 'buffer' } },
    // Pre-bundle every dependency up front and transform all app modules when
    // the dev server starts, so opening the page never waits on a first-hit
    // compile or a "new dependencies optimized, reloading" round trip.
    optimizeDeps: {
      entries: ['index.html'],
      include: ['events', 'buffer', 'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@theqrl/web3'],
      esbuildOptions: { define: { global: 'globalThis' } },
    },
    // strictPort: a second `npm run dev` must fail loudly, not slip to 5181
    // while the browser keeps hitting a stale server still holding 5180.
    server: { port: 5180, strictPort: true, proxy: rpcProxy, warmup: { clientFiles: ['./src/**/*.tsx', './src/**/*.ts', './src/**/*.css'] } },
    preview: { port: 5181, proxy: rpcProxy },
  };
});
