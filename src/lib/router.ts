import { useEffect, useState } from 'react';

export type ExploreTab = 'tokens' | 'pools' | 'transactions';
export type PredictTab = 'markets' | 'quests' | 'leaderboard' | 'rewards';
export const PREDICT_TABS: PredictTab[] = ['markets', 'quests', 'leaderboard', 'rewards'];

export type Route =
  | { page: 'swap' }
  | { page: 'explore'; tab: ExploreTab }
  /// Token detail; `address` is a token address or "QRL" for the native coin.
  | { page: 'token'; address: string }
  /// Pool detail; `address` is a V2 pair or a V3 pool.
  | { page: 'poolDetail'; address: string }
  | { page: 'positions' }
  | { page: 'newPosition' }
  | { page: 'v3pos'; id: string }
  | { page: 'v2pos'; pair: string }
  | { page: 'predict'; tab: PredictTab }
  | { page: 'predictMarket'; id: string };

export type Nav = 'swap' | 'explore' | 'pool' | 'predict';
export const navOf = (r: Route): Nav =>
  r.page === 'swap'
    ? 'swap'
    : r.page === 'explore' || r.page === 'token' || r.page === 'poolDetail'
      ? 'explore'
      : r.page === 'predict' || r.page === 'predictMarket'
        ? 'predict'
        : 'pool';

export function parseRoute(hash: string): Route {
  const [path] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'explore') {
    if (parts[1] === 'tokens' && parts[2]) return { page: 'token', address: parts[2] };
    if (parts[1] === 'pools' && parts[2]) return { page: 'poolDetail', address: parts[2] };
    if (parts[1] === 'pools') return { page: 'explore', tab: 'pools' };
    if (parts[1] === 'transactions') return { page: 'explore', tab: 'transactions' };
    return { page: 'explore', tab: 'tokens' };
  }
  if (parts[0] === 'pool' || parts[0] === 'positions') {
    if (parts[1] === 'new') return { page: 'newPosition' };
    if (parts[1] === 'v3' && parts[2] && parts[2] !== 'new') return { page: 'v3pos', id: parts[2] };
    if (parts[1] === 'v2' && parts[2] && parts[2] !== 'new') return { page: 'v2pos', pair: parts[2] };
    if (parts[1] === 'v2' || parts[1] === 'v3') return { page: 'newPosition' };
    return { page: 'positions' };
  }
  if (parts[0] === 'predict') {
    if (parts[1] === 'market' && parts[2]) return { page: 'predictMarket', id: parts[2] };
    const tab = PREDICT_TABS.find((t) => t === parts[1]);
    return { page: 'predict', tab: tab ?? 'markets' };
  }
  return { page: 'swap' };
}

export const query = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '');

export function href(r: Route, params?: Record<string, string | number | undefined>): string {
  let base: string;
  switch (r.page) {
    case 'swap':
      base = '#/swap';
      break;
    case 'explore':
      base = r.tab === 'tokens' ? '#/explore' : `#/explore/${r.tab}`;
      break;
    case 'token':
      base = `#/explore/tokens/${r.address}`;
      break;
    case 'poolDetail':
      base = `#/explore/pools/${r.address}`;
      break;
    case 'positions':
      base = '#/pool';
      break;
    case 'newPosition':
      base = '#/pool/new';
      break;
    case 'v3pos':
      base = `#/pool/v3/${r.id}`;
      break;
    case 'v2pos':
      base = `#/pool/v2/${r.pair}`;
      break;
    case 'predict':
      base = r.tab === 'markets' ? '#/predict' : `#/predict/${r.tab}`;
      break;
    case 'predictMarket':
      base = `#/predict/market/${r.id}`;
      break;
  }
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export const go = (r: Route, params?: Record<string, string | number | undefined>) => {
  window.location.hash = href(r, params).slice(1);
};

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    let path = window.location.hash.split('?')[0];
    const onHash = () => {
      setRoute(parseRoute(window.location.hash));
      const next = window.location.hash.split('?')[0];
      if (next !== path) window.scrollTo(0, 0);
      path = next;
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
