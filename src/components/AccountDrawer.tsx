import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CHAIN } from '../config';
import { useBalances } from '../hooks/chain';
import { useFaucets } from '../hooks/faucet';
import { useQrlFaucet } from '../hooks/qrlFaucet';
import { useNames } from '../hooks/names';
import { usePositions } from '../hooks/pools';
import { useV3Positions } from '../hooks/v3';
import { shortAddress } from '../lib/chain';
import { formatAmount, toFloat, timeAgo } from '../lib/format';
import { go, href } from '../lib/router';
import { NATIVE, Token, tokenKey } from '../lib/tokens';
import { useApp } from '../state/app';
import { Activity, useTx } from '../state/tx';
import { ProviderDetail, useWallet } from '../state/wallet';
import { span, useCountdown } from './predict';
import { Badge, Busy, CopyAddress, explorerHref, Icon, Modal, PairIcon, PoolBadges, Seg, TokenIcon } from './ui';

const INSTALL_URL = 'https://chromewebstore.google.com/search/QRL%20Web3%20Wallet';
const walletLabel = (p: ProviderDetail | null) => (!p || p.info.name === 'QRLWeb3Wallet' ? 'QRL Web3 Wallet' : p.info.name);
const qrl = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 1 : 2, minimumFractionDigits: n >= 100 ? 1 : 2 })} QRL`);

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/// Connect a wallet (97:388): a panel under the header's Connect button.
export function ConnectPanel() {
  const { providers, connect, connecting, error } = useWallet();
  const { openModal } = useApp();
  const [pending, setPending] = useState<string | null>(null);
  const close = () => openModal(null);
  useEscape(close);
  const qrlWallet = providers.find((p) => p.info.rdns === 'theqrl.org') ?? null;
  const others = providers.filter((p) => p !== qrlWallet);

  const onConnect = async (p: ProviderDetail) => {
    setPending(p.info.uuid);
    try {
      await connect(p);
      close();
    } catch {
      /* the error is shown from wallet state */
    } finally {
      setPending(null);
    }
  };

  return createPortal(
    <>
      <div className="scrim light" style={{ background: 'transparent' }} onMouseDown={close} />
      <div className="popover connect-panel" role="dialog" aria-label="Connect a wallet">
        <div className="modal-header">
          <span className="title">Connect a wallet</span>
          <button className="close" onClick={close} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>
        <button className={`wallet-option${qrlWallet ? ' detected' : ''}`} disabled={!qrlWallet || connecting} onClick={() => qrlWallet && onConnect(qrlWallet)}>
          <span className="logo qrl">
            <Icon name="wallet" size={22} />
          </span>
          <span className="col grow" style={{ gap: 2 }}>
            <span className="t-body-strong">QRL Web3 Wallet</span>
            <span className="t-caption c-3">{pending && pending === qrlWallet?.info.uuid ? 'Confirm in the extension…' : 'Browser extension · theqrl.org'}</span>
          </span>
          {pending && pending === qrlWallet?.info.uuid ? (
            <Icon name="loader" size={20} className="spin c-quantum" />
          ) : qrlWallet ? (
            <Badge tone="success">Detected</Badge>
          ) : (
            <span className="t-caption c-4">Not installed</span>
          )}
        </button>
        {others.length ? (
          others.map((p) => (
            <button key={p.info.uuid} className="wallet-option" disabled={connecting} onClick={() => onConnect(p)}>
              <span className="logo">{p.info.icon ? <img src={p.info.icon} alt="" width={22} height={22} /> : <Icon name="layers" size={22} />}</span>
              <span className="col grow" style={{ gap: 2 }}>
                <span className="t-body-strong">{walletLabel(p)}</span>
                <span className="t-caption c-3">{pending === p.info.uuid ? 'Confirm in the extension…' : 'EIP-6963 wallet'}</span>
              </span>
              {pending === p.info.uuid ? <Icon name="loader" size={20} className="spin c-quantum" /> : <Badge tone="success">Detected</Badge>}
            </button>
          ))
        ) : (
          <div className="wallet-option" aria-disabled>
            <span className="logo">
              <Icon name="layers" size={22} />
            </span>
            <span className="col grow" style={{ gap: 2 }}>
              <span className="t-body-strong c-2">Other QRL wallets</span>
              <span className="t-caption c-3">Any EIP-6963 wallet that supports QRVM</span>
            </span>
            <span className="t-caption c-4 nowrap">None found</span>
          </div>
        )}
        {error && <span className="t-caption c-alert">{error}</span>}
        <hr className="divider" />
        <div className="row t-caption c-3" style={{ alignItems: 'flex-start' }}>
          <Icon name="info" size={16} />
          <span>
            PauliSwap runs on {CHAIN.name} (chain {CHAIN.id}). Your wallet will be asked to add it if missing.
          </span>
        </div>
        {!qrlWallet && (
          <a className="row link t-body-strong" href={INSTALL_URL} target="_blank" rel="noreferrer" style={{ gap: 6 }}>
            No wallet yet? Install QRL Web3 Wallet
            <Icon name="external-link" size={14} />
          </a>
        )}
      </div>
    </>,
    document.body,
  );
}

/// Wrong network (97:980).
export function WrongNetworkModal() {
  const { chainId, switchChain, disconnect } = useWallet();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const current = chainId === 1 ? 'QRL Mainnet' : `Chain ${chainId}`;
  return (
    <Modal onClose={() => setDismissed(true)} width={420} center hideHeader>
      <div className="status-block">
        <span className="center" style={{ padding: 12, borderRadius: 999, background: 'var(--warning-bg)' }}>
          <Icon name="alert-triangle" size={28} className="c-warning" />
        </span>
        <span className="t-title">Wrong network</span>
        <span className="t-body c-2">
          Your wallet is on {current}. PauliSwap contracts are deployed on {CHAIN.name} only.
        </span>
      </div>
      <div className="steps" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 10 }}>
          <TokenIcon token={NATIVE} size={24} />
          <span className="t-body-strong c-2 grow">{current}</span>
          <span className="t-label c-3">Connected</span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <TokenIcon token={NATIVE} size={24} />
          <span className="t-body-strong grow">
            {CHAIN.name} · {CHAIN.id}
          </span>
          <span className="t-label c-quantum">Required</span>
        </div>
      </div>
      <button
        className="btn btn-lg btn-primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          switchChain()
            .catch(() => undefined)
            .finally(() => setBusy(false));
        }}
      >
        {busy && <Icon name="loader" size={20} className="spin" />}
        {busy ? 'Confirm in your wallet…' : `Switch to ${CHAIN.name}`}
      </button>
      <button className="t-body-strong c-3" onClick={() => disconnect()}>
        Disconnect wallet
      </button>
    </Modal>
  );
}

type Tab = 'tokens' | 'pools' | 'activity';

/// Account drawer (97:585): balance, quick actions, Tokens / Pools / Activity.
export function AccountDrawer() {
  const { account, active, disconnect } = useWallet();
  const { tokens, openModal, priceInQrl } = useApp();
  const { faucetTokens, claim } = useFaucets();
  const qrlFaucet = useQrlFaucet(account);
  const qrlLeft = useCountdown(qrlFaucet.nextAt || undefined);
  const [tab, setTab] = useState<Tab>('tokens');
  const [showZero, setShowZero] = useState(false);
  const balanceOf = useBalances(tokens, account);
  const close = () => openModal(null);
  useEscape(close);
  if (!account) return null;

  const valueOf = (t: Token) => {
    const b = balanceOf(t);
    const p = priceInQrl(t);
    return b === undefined || p === undefined ? null : toFloat(b, t.decimals) * p;
  };
  const held = tokens.filter((t) => (balanceOf(t) ?? 0n) > 0n).sort((a, b) => (a.native ? -1 : b.native ? 1 : (valueOf(b) ?? 0) - (valueOf(a) ?? 0)));
  const zero = tokens.filter((t) => balanceOf(t) === 0n);
  const total = held.reduce((s, t) => s + (valueOf(t) ?? 0), 0);
  const nav = (fn: () => void) => () => {
    close();
    fn();
  };
  const explorer = explorerHref('address', account);

  return createPortal(
    <>
      <div className="scrim" style={{ zIndex: 60 }} onMouseDown={close} />
      <aside className="drawer" aria-label="Account">
        <div className="row" style={{ gap: 10 }}>
          <span className="avatar" style={{ width: 40, height: 40 }} />
          <span className="col grow" style={{ gap: 2 }}>
            <span className="t-body-strong c-1">
              <CopyAddress address={account} />
            </span>
            <span className="t-caption c-3">{walletLabel(active)}</span>
          </span>
          {explorer && (
            <a className="drawer-icon" href={explorer} target="_blank" rel="noreferrer" title="View on QRL explorer">
              <Icon name="external-link" size={18} />
            </a>
          )}
          <button
            className="drawer-icon"
            title="Disconnect"
            onClick={async () => {
              await disconnect();
              close();
            }}
          >
            <Icon name="log-out" size={18} />
          </button>
        </div>
        <div className="col" style={{ gap: 4 }}>
          <span className="t-display num">{formatAmount(balanceOf(NATIVE), 18, 2)} QRL</span>
          <span className="t-label c-3">Wallet value ≈ {qrl(total)} incl. tokens</span>
        </div>
        <div className={`drawer-actions${qrlFaucet.available ? ' four' : ''}`}>
          <button onClick={nav(() => go({ page: 'swap' }))}>
            <Icon name="arrow-up-down" size={20} />
            Swap
          </button>
          <button onClick={nav(() => go({ page: 'newPosition' }))}>
            <Icon name="plus" size={20} />
            Add liquidity
          </button>
          {qrlFaucet.available && (
            <button
              disabled={qrlFaucet.claiming || !!qrlFaucet.nextAt || qrlFaucet.nextAt === undefined}
              title={qrlFaucet.nextAt ? `Next claim in ${span(qrlLeft ?? 0)}` : `${qrlFaucet.amount} once a day; nothing to sign, no gas needed`}
              onClick={qrlFaucet.claim}
            >
              <Icon name={qrlFaucet.claiming ? 'loader' : qrlFaucet.nextAt ? 'clock' : 'plus'} size={20} />
              {qrlFaucet.claiming ? 'Sending…' : qrlFaucet.nextAt ? span(qrlLeft ?? 0) : 'Get QRL'}
            </button>
          )}
          <button disabled={!faucetTokens.length} title={faucetTokens.length ? 'Claim devnet test tokens' : 'No faucet tokens on this devnet'} onClick={async () => {
              for (const t of faucetTokens) if (!(await claim(t))) break;
            }}>
            <Icon name="wallet" size={20} />
            {qrlFaucet.available ? 'Test tokens' : 'Faucet'}
          </button>
        </div>
        <Seg options={['tokens', 'pools', 'activity'] as const} labels={{ tokens: 'Tokens', pools: 'Pools', activity: 'Activity' }} value={tab} onChange={setTab} />
        <div className="drawer-list">
          {tab === 'tokens' && (
            <>
              {held.map((t) => (
                <TokenLine key={tokenKey(t)} token={t} balance={balanceOf(t)} value={valueOf(t)} onClick={nav(() => go({ page: 'token', address: t.native ? 'QRL' : t.address }))} />
              ))}
              {showZero && zero.map((t) => <TokenLine key={tokenKey(t)} token={t} balance={0n} value={0} onClick={nav(() => go({ page: 'token', address: t.native ? 'QRL' : t.address }))} />)}
              {zero.length > 0 && (
                <div className="row" style={{ padding: '10px 4px' }}>
                  <span className="t-body c-3 grow">Zero balances ({zero.length})</span>
                  <button className="btn btn-sm btn-tertiary" onClick={() => setShowZero((v) => !v)}>
                    {showZero ? 'Hide' : 'Show'}
                  </button>
                </div>
              )}
            </>
          )}
          {tab === 'pools' && <PoolsTab account={account} onNavigate={close} />}
          {tab === 'activity' && <ActivityTab />}
        </div>
      </aside>
    </>,
    document.body,
  );
}

function TokenLine({ token, balance, value, onClick }: { token: Token; balance: bigint | undefined; value: number | null; onClick: () => void }) {
  const { sym } = useNames();
  return (
    <button className="drawer-row" onClick={onClick}>
      <TokenIcon token={token} size={36} />
      <span className="col grow" style={{ gap: 2 }}>
        <span className="t-body-strong ellipsis">{token.native ? 'Quantum Resistant Ledger' : token.name}</span>
        <span className="t-num c-3">
          {formatAmount(balance, token.decimals, 2)} {sym(token)}
        </span>
      </span>
      <span className="t-num-strong">{qrl(value)}</span>
    </button>
  );
}

function PoolsTab({ account, onNavigate }: { account: string; onNavigate: () => void }) {
  const { tokenByAddress, priceInQrl, decimalsOf } = useApp();
  const { sym, symOf } = useNames();
  const v2 = usePositions(account);
  const v3 = useV3Positions(account);
  const value = (t0: string, a0: bigint, t1: string, a1: bigint) => {
    const p0 = priceInQrl(t0);
    const p1 = priceInQrl(t1);
    return p0 === undefined || p1 === undefined ? null : toFloat(a0, decimalsOf(t0)) * p0 + toFloat(a1, decimalsOf(t1)) * p1;
  };
  if (!v2 || !v3) return <Busy className="list-note">Loading positions…</Busy>;
  const open3 = v3.filter((p) => p.liquidity > 0n);
  if (!v2.length && !open3.length)
    return (
      <span className="list-note">
        No open positions. <a className="link" href={href({ page: 'newPosition' })} onClick={onNavigate}>Add liquidity</a>
      </span>
    );
  return (
    <>
      {open3.map((p) => (
        <a key={p.id} className="drawer-row" href={href({ page: 'v3pos', id: p.id })} onClick={onNavigate}>
          <PairIcon a={tokenByAddress(p.token0)} b={tokenByAddress(p.token1)} size={28} />
          <span className="col grow" style={{ gap: 2 }}>
            <span className="row" style={{ gap: 6 }}>
              <span className="t-body-strong">
                {symOf(p.token0)} / {symOf(p.token1)}
              </span>
              <Badge tone={p.status === 'in' ? 'success' : 'warning'}>{p.status === 'in' ? 'In range' : 'Out of range'}</Badge>
            </span>
            <span className="row t-caption c-3" style={{ gap: 6 }}>
              V3 · #{p.id}
            </span>
          </span>
          <span className="t-num-strong">{qrl(value(p.token0, p.amount0, p.token1, p.amount1))}</span>
        </a>
      ))}
      {v2.map((p) => {
        const a0 = p.totalSupply > 0n ? (p.reserve0 * p.balance) / p.totalSupply : 0n;
        const a1 = p.totalSupply > 0n ? (p.reserve1 * p.balance) / p.totalSupply : 0n;
        return (
          <a key={p.address} className="drawer-row" href={href({ page: 'v2pos', pair: p.address })} onClick={onNavigate}>
            <PairIcon a={p.token0Info} b={p.token1Info} size={28} />
            <span className="col grow" style={{ gap: 2 }}>
              <span className="row" style={{ gap: 6 }}>
                <span className="t-body-strong">
                  {sym(p.token0Info)} / {sym(p.token1Info)}
                </span>
                <PoolBadges version="v2" fee={3000} />
              </span>
              <span className="t-caption c-3">{formatAmount(p.balance, 18, 2)} LP tokens</span>
            </span>
            <span className="t-num-strong">{qrl(value(p.token0, a0, p.token1, a1))}</span>
          </a>
        );
      })}
    </>
  );
}

function ActivityTab() {
  const { activity } = useTx();
  if (!activity.length) return <span className="list-note">Transactions you send from PauliSwap appear here.</span>;
  const today = new Date().toDateString();
  const groups = new Map<string, Activity[]>();
  for (const a of activity) {
    const d = new Date(a.time).toDateString();
    const label = d === today ? 'Today' : new Date(a.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    groups.set(label, [...(groups.get(label) ?? []), a]);
  }
  return (
    <>
      {[...groups].map(([label, list]) => (
        <div key={label} className="col" style={{ gap: 2 }}>
          <span className="t-label c-3" style={{ padding: '0 4px' }}>
            {label}
          </span>
          {list.map((a) => {
            const link = explorerHref('tx', a.hash);
            const body = (
              <>
                <span className="activity-icon">
                  <Icon
                    name={a.status === 'success' ? 'circle-check' : a.status === 'failed' ? 'circle-x' : 'loader'}
                    size={20}
                    className={a.status === 'success' ? 'c-success' : a.status === 'failed' ? 'c-alert' : 'c-quantum spin'}
                  />
                </span>
                <span className="col grow" style={{ gap: 2 }}>
                  <span className="t-body-strong">{a.status === 'failed' ? `${a.title} failed` : a.title}</span>
                  <span className="t-num c-3 ellipsis">{a.sub ?? shortAddress(a.hash, 6)}</span>
                </span>
                <span className="t-caption c-3">{Date.now() - a.time < 60_000 ? 'now' : timeAgo(a.time)}</span>
              </>
            );
            return link ? (
              <a key={a.hash} className="drawer-row" href={link} target="_blank" rel="noreferrer">
                {body}
              </a>
            ) : (
              <div key={a.hash} className="drawer-row" title={a.hash}>
                {body}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
