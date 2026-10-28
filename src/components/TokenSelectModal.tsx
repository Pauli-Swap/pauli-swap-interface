import { useEffect, useMemo, useState } from 'react';
import { useBalances } from '../hooks/chain';
import { isQAddress, sameAddress, shortAddress } from '../lib/chain';
import { formatAmount } from '../lib/format';
import { displaySymbol, fetchTokenMetadata, importToken, sameToken, Token, tokenKey } from '../lib/tokens';
import { useApp } from '../state/app';
import { useWallet } from '../state/wallet';
import { Banner, Busy, CopyAddress, Icon, Modal, TokenIcon } from './ui';

/// Select a token (91:579).
export function TokenSelectModal({
  onSelect,
  onClose,
  selected,
}: {
  onSelect: (t: Token) => void;
  onClose: () => void;
  selected?: Token | null;
  other?: Token | null;
}) {
  const { tokens, tokensLoading, refreshTokens } = useApp();
  const { account } = useWallet();
  const [query, setQuery] = useState('');
  const [candidate, setCandidate] = useState<Token | null>(null);
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'error'>('idle');
  const [importing, setImporting] = useState<Token | null>(null);
  const [understood, setUnderstood] = useState(false);
  const balanceOf = useBalances(tokens, account);

  const q = query.trim();
  const matches = useMemo(() => {
    const needle = q.toLowerCase();
    return !needle
      ? tokens
      : tokens.filter((t) => t.symbol.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle) || (!t.native && t.address.toLowerCase() === needle));
  }, [tokens, q]);
  const held = matches.filter((t) => (balanceOf(t) ?? 0n) > 0n).sort((a, b) => Number((balanceOf(b) ?? 0n) > (balanceOf(a) ?? 0n)) - 0.5);
  const rest = matches.filter((t) => !held.includes(t));

  // A pasted Q address that is not in the list can be imported.
  useEffect(() => {
    setCandidate(null);
    if (!isQAddress(q) || tokens.some((t) => !t.native && sameAddress(t.address, q))) return setLookup('idle');
    let alive = true;
    setLookup('loading');
    fetchTokenMetadata(q)
      .then((t) => alive && (setCandidate(t), setLookup('idle')))
      .catch(() => alive && setLookup('error'));
    return () => {
      alive = false;
    };
  }, [q, tokens]);

  if (importing) {
    return (
      <Modal title="Import token" onClose={onClose}>
        <div className="status-block">
          <TokenIcon token={importing} size={56} />
          <span className="t-title">{importing.symbol}</span>
          <span className="t-body c-3">{importing.name}</span>
          <CopyAddress address={importing.address} size={6} boxed />
        </div>
        <Banner tone="alert" title="Unverified token">
          This token is not in an PauliSwap pool. Anyone can deploy an SQRC-TF1 contract with any name and symbol. Check the Q address before trading.
        </Banner>
        <label className="row t-body" style={{ gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} style={{ accentColor: 'var(--quantum)', width: 18, height: 18 }} />
          I understand the risk
        </label>
        <div className="row">
          <button className="btn btn-lg btn-tertiary grow" onClick={() => setImporting(null)}>
            Back
          </button>
          <button
            className="btn btn-lg btn-primary grow"
            disabled={!understood}
            onClick={() => {
              importToken(importing);
              refreshTokens();
              onSelect({ ...importing, imported: true });
            }}
          >
            Import
          </button>
        </div>
      </Modal>
    );
  }

  const bases = tokens.slice(0, 5);
  const row = (t: Token) => {
    const bal = balanceOf(t);
    const isSel = sameToken(t, selected);
    return (
      <button key={tokenKey(t)} className={`token-row${isSel ? ' selected' : ''}`} onClick={() => onSelect(t)}>
        <TokenIcon token={t} size={36} />
        <span className="col grow" style={{ gap: 2 }}>
          <span className="t-body-strong ellipsis">{t.native ? 'Quantum Resistant Ledger' : t.name || t.symbol}</span>
          <span className="row t-num c-3" style={{ gap: 6 }}>
            <span>{displaySymbol(t, tokens)}</span>
            {!t.native && <span className="c-4">{shortAddress(t.address)}</span>}
          </span>
        </span>
        {account && bal !== undefined && bal > 0n && <span className="t-num-strong">{formatAmount(bal, t.decimals)}</span>}
        {isSel && <Icon name="check" size={18} className="c-quantum" />}
      </button>
    );
  };

  return (
    <Modal onClose={onClose} hideHeader>
      <div className="token-modal">
        <div className="top">
          <div className="modal-header">
            <span className="title">Select a token</span>
            <button className="close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={20} />
            </button>
          </div>
          <label className="search-field">
            <Icon name="search" size={18} />
            <input autoFocus placeholder="Search name or paste Q address" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="bases">
            {bases.map((t) => (
              <button key={tokenKey(t)} className={`base-chip${sameToken(t, selected) ? ' on' : ''}`} onClick={() => onSelect(t)}>
                <TokenIcon token={t} size={20} />
                <span>{displaySymbol(t, tokens)}</span>
              </button>
            ))}
          </div>
        </div>
        <hr className="divider" />
        <div className="list">
          {candidate && (
            <button className="token-row" onClick={() => setImporting(candidate)}>
              <TokenIcon token={candidate} size={36} />
              <span className="col grow" style={{ gap: 2 }}>
                <span className="t-body-strong">{candidate.name}</span>
                <span className="t-num c-3">{candidate.symbol}</span>
              </span>
              <span className="btn btn-sm btn-secondary">Import</span>
            </button>
          )}
          {lookup === 'loading' && <Busy className="list-note">Looking up token…</Busy>}
          {lookup === 'error' && <span className="list-note c-alert">No SQRC-TF1 token at this address.</span>}
          {held.length > 0 && (
            <>
              <span className="list-section">
                <Icon name="wallet" size={14} /> Your tokens
              </span>
              {held.map(row)}
            </>
          )}
          {rest.length > 0 && (
            <>
              <span className="list-section">
                <Icon name="layers" size={14} /> All devnet tokens
                {tokensLoading && <Icon name="loader" size={14} className="spin" />}
              </span>
              {rest.map(row)}
            </>
          )}
          {!matches.length && !candidate && lookup === 'idle' && <span className="list-note">No tokens found.</span>}
        </div>
      </div>
    </Modal>
  );
}
