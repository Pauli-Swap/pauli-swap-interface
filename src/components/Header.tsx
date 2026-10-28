import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { CHAIN } from '../config';
import { useNames } from '../hooks/names';
import { sameAddress, shortAddress } from '../lib/chain';
import { go, href, Nav } from '../lib/router';
import { NATIVE, tokenKey } from '../lib/tokens';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { useWallet } from '../state/wallet';
import { Icon, PairIcon, PoolBadges, TokenIcon } from './ui';

const NAV: { key: Nav; label: string; href: string }[] = [
  { key: 'swap', label: 'Trade', href: href({ page: 'swap' }) },
  { key: 'explore', label: 'Explore', href: href({ page: 'explore', tab: 'tokens' }) },
  { key: 'pool', label: 'Pool', href: href({ page: 'positions' }) },
  { key: 'predict', label: 'Predict', href: href({ page: 'predict', tab: 'markets' }) },
];

/// Global header (88:226): logo, Trade / Explore / Pool / Predict, search, chain chip, wallet.
export function Header({ nav }: { nav: Nav }) {
  const { account, wrongNetwork, switchChain } = useWallet();
  const { openModal, modalOpen, rpcError, poolsLoaded, tokensLoading } = useApp();
  const { pendingCount } = useTx();
  const bad = wrongNetwork || !!rpcError;
  const syncing = !rpcError && (!poolsLoaded || tokensLoading);

  return (
    <header className="header">
      <div className="header-side">
        <a className="brand" href={href({ page: 'swap' })}>
          <img src="/pauli-mark.svg" alt="" />
          <span>PauliSwap</span>
        </a>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.key} href={n.href} className={nav === n.key ? 'on' : ''} aria-current={nav === n.key ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
      </div>
      <Search />
      <div className="header-side end">
        <button
          className={`chip-btn${bad ? ' wrong' : ''}`}
          title={rpcError ? `RPC error: ${rpcError}` : `${CHAIN.name} · chain ${CHAIN.id}`}
          onClick={() => wrongNetwork && switchChain().catch(() => undefined)}
        >
          {bad ? (
            <Icon name="alert-triangle" size={24} />
          ) : (
            <TokenIcon token={NATIVE} size={24} />
          )}
          <span className="hide-sm">{rpcError ? 'RPC offline' : wrongNetwork ? 'Wrong network' : CHAIN.name}</span>
          <Icon name="chevron-down" size={16} className="c-3" />
        </button>
        {account ? (
          <button className="chip-btn wallet" onClick={() => openModal(modalOpen === 'account' ? null : 'account')}>
            {pendingCount > 0 ? <Icon name="loader" size={24} className="c-quantum spin" /> : <span className="avatar" />}
            <span className="num">{pendingCount > 0 ? `${pendingCount} pending` : shortAddress(account)}</span>
          </button>
        ) : (
          <button className="btn btn-primary" style={{ height: 36, padding: '0 16px', borderRadius: 999 }} onClick={() => openModal(modalOpen === 'connect' ? null : 'connect')}>
            Connect
          </button>
        )}
      </div>
      {syncing && <span className="top-progress" role="progressbar" aria-label="Loading on-chain data" />}
    </header>
  );
}

function Search() {
  const { tokens, pools, tokenByAddress } = useApp();
  const { sym } = useNames();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName ?? '')) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return { tokens: [], pools: [] };
    const tokenHits = tokens.filter((t) => t.symbol.toLowerCase().includes(term) || t.name.toLowerCase().includes(term) || (!t.native && t.address.toLowerCase() === term));
    const poolHits = pools.filter((p) => {
      const a = tokenByAddress(p.token0);
      const b = tokenByAddress(p.token1);
      const name = `${a?.symbol ?? ''}/${b?.symbol ?? ''}`.toLowerCase();
      return name.includes(term.replace(/\s/g, '')) || sameAddress(p.address, term) || [a, b].some((t) => t && t.symbol.toLowerCase().includes(term));
    });
    return { tokens: tokenHits.slice(0, 5), pools: poolHits.slice(0, 5) };
  }, [q, tokens, pools, tokenByAddress]);

  const close = () => {
    setOpen(false);
    setQ('');
    input.current?.blur();
  };

  return (
    <label className="search-field">
      <Icon name="search" size={18} />
      <input
        ref={input}
        placeholder="Search tokens and pools"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === 'Escape' && close()}
      />
      <span className="kbd">/</span>
      {open && q.trim() && (
        <div className="search-results">
          {!results.tokens.length && !results.pools.length && <span className="section">No tokens or pools match "{q.trim()}"</span>}
          {results.tokens.length > 0 && <span className="section">Tokens</span>}
          {results.tokens.map((t) => (
            <Result
              key={tokenKey(t)}
              onClick={() => {
                go({ page: 'token', address: t.native ? 'QRL' : t.address });
                close();
              }}
              icon={<TokenIcon token={t} size={28} />}
              title={t.native ? 'QRL' : t.name}
              sub={t.native ? 'Native coin' : `${sym(t)} · ${shortAddress(t.address)}`}
            />
          ))}
          {results.pools.length > 0 && <span className="section">Pools</span>}
          {results.pools.map((p) => {
            const a = tokenByAddress(p.token0);
            const b = tokenByAddress(p.token1);
            return (
              <Result
                key={p.id}
                onClick={() => {
                  go({ page: 'poolDetail', address: p.address });
                  close();
                }}
                icon={<PairIcon a={a} b={b} size={24} />}
                title={`${sym(a)} / ${sym(b)}`}
                sub={shortAddress(p.address)}
                tail={<PoolBadges version={p.version} fee={p.fee} />}
              />
            );
          })}
        </div>
      )}
    </label>
  );
}

function Result({ icon, title, sub, tail, onClick }: { icon: ReactNode; title: string; sub: string; tail?: ReactNode; onClick: () => void }) {
  return (
    <button onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {icon}
      <span className="col grow" style={{ gap: 0 }}>
        <span className="t-body-strong">{title}</span>
        <span className="t-caption c-3">{sub}</span>
      </span>
      {tail}
    </button>
  );
}
