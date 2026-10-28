import { useMemo, useState } from 'react';
import { AreaChart, stampLabel } from '../components/Chart';
import { dateLabel, longSpan, NotDeployed, utcTime, XP_TOKEN } from '../components/predict';
import { AmountPanel, Badge, Crumbs, DetailRow, Empty, IconButton, Seg, Stat } from '../components/ui';
import { PREDICT } from '../config';
import { MarketView, Position, useMarkets, usePosition, usePredictLogs, useXp } from '../hooks/predict';
import { predictMarket } from '../lib/chain';
import { applySlippage, parseUnits, toInputString } from '../lib/format';
import { load, save } from '../lib/storage';
import { CANCELLED, fmtChance, fmtPrice, fmtXp, maxSellXp, NO, OPEN, Outcome, quoteBuy, quoteSell, RESOLVED, XP_DECIMALS, xpFloat, YES } from '../lib/predict';
import { href, query } from '../lib/router';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { useWallet } from '../state/wallet';
import { sharePage } from './TokenDetail';

const RANGES = { '1D': 86400, '1W': 7 * 86400, '1M': 30 * 86400, All: Infinity } as const;
type Range = keyof typeof RANGES;
const WATCH_KEY = 'acorn.predict.watch';

/// Predict · Market (114:4903) and its guest variant (114:5151).
export function PredictMarket({ id }: { id: string }) {
  const logs = usePredictLogs();
  const markets = useMarkets(logs.market);
  const n = Number(id);
  const market = markets?.find((m) => m.id === n);
  const crumbs = (
    <Crumbs
      items={[
        { label: 'Predict', href: href({ page: 'predict', tab: 'markets' }) },
        { label: 'Markets', href: href({ page: 'predict', tab: 'markets' }) },
        { label: `#${id}` },
      ]}
    />
  );
  if (!PREDICT.deployed)
    return (
      <main className="page pm-page">
        {crumbs}
        <NotDeployed />
      </main>
    );
  if (!market)
    return (
      <main className="page pm-page">
        {crumbs}
        {markets ? (
          <Empty icon="alert-triangle" title="Market not found">
            PredictMarket has no market #{id}.
          </Empty>
        ) : (
          <Empty icon="loader" title="Loading market…" />
        )}
      </main>
    );
  return (
    <main className="page pm-page">
      {crumbs}
      <MarketDetail m={market} />
    </main>
  );
}

function MarketDetail({ m }: { m: MarketView }) {
  const { clock, blockTime } = useApp();
  const [range, setRange] = useState<Range>('All');
  const [watched, setWatched] = useState(() => load<number[]>(WATCH_KEY, []).includes(m.id));
  const now = clock.latestTime;
  const points = useMemo(() => {
    const from = now - RANGES[range];
    const inside = m.history.filter((p) => p.t >= from);
    // Start the window at the price that held when it opened.
    const before = m.history.filter((p) => p.t < from).pop();
    return before && inside.length ? [{ t: from, v: before.v }, ...inside] : inside;
  }, [m.history, range, now]);
  const change = m.price24h === null ? null : (m.price - m.price24h) * 100;
  const toggleWatch = () => {
    const list = load<number[]>(WATCH_KEY, []).filter((x) => x !== m.id);
    if (!watched) list.push(m.id);
    save(WATCH_KEY, list);
    setWatched(!watched);
  };
  const status =
    m.status === RESOLVED ? `Resolved ${m.outcome === YES ? 'Yes' : 'No'}` : m.status === CANCELLED ? 'Cancelled' : m.closeTime <= now ? 'Closed, awaiting result' : 'Open';

  return (
    <div className="pm-detail">
      <div className="pm-main">
        <div className="col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <h1>{m.question}</h1>
            <div className="row" style={{ gap: 4 }}>
              <IconButton icon="star" label={watched ? 'Remove from watchlist' : 'Add to watchlist'} onClick={toggleWatch} filled={watched} size={18} />
              <IconButton icon="share" label="Copy link" onClick={sharePage} size={18} />
            </div>
          </div>
          <span className="t-body c-3" style={{ whiteSpace: 'pre' }}>
            {`#${m.id}  ·  ${m.status === OPEN ? `Ends ${dateLabel(m.closeTime)}` : status}  ·  ${fmtXp(m.volume, { compact: true })} volume`}
          </span>
        </div>
        <div className="pm-chance">
          {m.status === OPEN ? (
            <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
              <span className="big">{fmtChance(m.price)}</span>
              <span className="t-body-strong c-2">chance of Yes</span>
            </div>
          ) : (
            <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
              <span className={`big ${m.status === RESOLVED ? (m.outcome === YES ? 'c-success' : 'c-alert') : ''}`}>{m.status === RESOLVED ? (m.outcome === YES ? 'Yes' : 'No') : 'Cancelled'}</span>
              <span className="t-body-strong c-2">{m.status === RESOLVED ? `won · last traded at ${fmtChance(m.price)} Yes` : 'each share claims 0.5 XP'}</span>
            </div>
          )}
          {m.status === OPEN && change !== null && <span className={`t-num ${change >= 0 ? 'c-success' : 'c-alert'}`}>{`${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}% today`}</span>}
        </div>
        <AreaChart points={points} height={300} format={(v) => `${Math.round(v * 100)}%`} unit="Yes" sub={(p) => stampLabel(p.t)} now={m.status === OPEN} />
        <div>
          <Seg boxed options={Object.keys(RANGES) as Range[]} value={range} onChange={setRange} />
        </div>
        <h2>Stats</h2>
        <div className="pm-detail-stats">
          <Stat label="Volume" value={fmtXp(m.volume, { compact: true })} />
          <Stat label="Open interest" value={fmtXp(m.staked > 0n ? m.staked : 0n, { compact: true })} />
          <Stat label="Traders" value={m.traders.toLocaleString('en-US')} />
          <Stat label={m.status === OPEN && m.closeTime > now ? 'Ends in' : 'Ended'} value={m.status === OPEN && m.closeTime > now ? longSpan(m.closeTime - now) : dateLabel(m.closeTime)} />
        </div>
        <h2>Rules</h2>
        <p className="t-body c-2">
          The PauliSwap Predict admin resolves this market Yes or No after it closes. Each winning share then pays 1 XP and each losing share pays 0. If the market is cancelled, every share, Yes or No, pays 0.5 XP.
        </p>
        <div className="pm-rows">
          <DetailRow label="Market" value={`#${m.id} on PredictMarket`} />
          <DetailRow label="Opened" value={dateLabel(blockTime(m.createdBlock))} />
          <DetailRow label="Closes" value={`${dateLabel(m.closeTime)} · ${utcTime(m.closeTime)}`} />
          <DetailRow label="Seed liquidity" value={fmtXp(m.liquidity)} />
          <DetailRow label="Status" value={status} />
        </div>
      </div>
      <TradePanel m={m} />
    </div>
  );
}

function TradePanel({ m }: { m: MarketView }) {
  const { account } = useWallet();
  const { openModal, settings, clock } = useApp();
  const { send } = useTx();
  const { xp } = useXp(account);
  const position = usePosition(m.id, account);
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [outcome, setOutcome] = useState<Outcome>(() => (query().get('outcome') === 'no' ? NO : YES));
  const [amount, setAmount] = useState('');
  const tradable = m.status === OPEN && m.closeTime > clock.latestTime;

  if (!tradable) return <SettledPanel m={m} position={position} account={account} />;

  const value = parseUnits(amount, XP_DECIMALS) ?? 0n;
  const held = position ? (outcome === YES ? position.yesShares : position.noShares) : 0n;
  const name = outcome === YES ? 'Yes' : 'No';
  const price = outcome === YES ? m.price : 1 - m.price;
  const shares = mode === 'buy' ? quoteBuy(m, outcome, value) : quoteSell(m, outcome, value);
  const maxSell = mode === 'sell' ? maxSellXp(m, outcome, held) : 0n;

  let error: string | null = null;
  if (mode === 'buy' && xp !== undefined && value > xp) error = 'Not enough XP';
  if (mode === 'sell' && shares === null) error = 'More than the pool can pay';
  else if (mode === 'sell' && shares !== null && shares > held) error = `Not enough ${name} shares`;

  const submit = () => {
    if (!shares) return;
    const isBuy = mode === 'buy';
    const bound = applySlippage(shares, settings.slippageBps, isBuy ? 'down' : 'up');
    send({
      title: isBuy ? `Buy ${name}` : `Sell ${name}`,
      verb: isBuy ? 'trade' : 'sale',
      activity: isBuy ? `Bought ${name} on #${m.id}` : `Sold ${name} on #${m.id}`,
      successTitle: isBuy ? 'Prediction placed' : 'Shares sold',
      successText: isBuy ? `${fmtXp(value)} for ${fmtXp(shares, { unit: false })} ${name} shares.` : `${fmtXp(shares, { unit: false })} ${name} shares for ${fmtXp(value)}.`,
      build: () => ({ to: PREDICT.market, method: isBuy ? predictMarket().methods.buy(m.id, outcome, value, bound) : predictMarket().methods.sell(m.id, outcome, value, bound) }),
    }).then((ok) => ok && setAmount(''));
  };

  const sharesF = shares ? xpFloat(shares) : 0;
  const valueF = xpFloat(value);
  return (
    <div className="pm-trade">
      <div>
        <Seg boxed options={['buy', 'sell'] as const} labels={{ buy: 'Buy', sell: 'Sell' }} value={mode} onChange={(v) => (setMode(v), setAmount(''))} />
      </div>
      <div className="pm-sides">
        {([YES, NO] as Outcome[]).map((o) => (
          <button key={o} className={`pm-side ${o === YES ? 'yes' : 'no'}${outcome === o ? ' on' : ''}`} onClick={() => setOutcome(o)}>
            <span className="name">{o === YES ? 'Yes' : 'No'}</span>
            <span className="price">{fmtPrice(o === YES ? m.price : 1 - m.price)}</span>
          </button>
        ))}
      </div>
      <AmountPanel
        label={mode === 'buy' ? 'Stake' : 'Receive'}
        token={XP_TOKEN}
        amount={amount}
        onAmount={setAmount}
        error={!!error}
        sub={value > 0n && shares ? (mode === 'buy' ? `≈ ${fmtXp(shares, { unit: false })} ${name} shares` : `Sells ${fmtXp(shares, { unit: false })} ${name} shares`) : mode === 'sell' ? `You hold ${fmtXp(held, { unit: false })} ${name} shares` : ' '}
        balance={account ? (mode === 'buy' ? fmtXp(xp, { unit: false }) : fmtXp(held, { unit: false }) + ' sh') : '—'}
        onMax={account ? () => setAmount(toInputString(mode === 'buy' ? xp ?? 0n : maxSell, XP_DECIMALS, 4)) : undefined}
      />
      {!account ? (
        <button className="btn btn-lg btn-primary btn-block" onClick={() => openModal('connect')}>
          Connect wallet
        </button>
      ) : (
        <button className="btn btn-lg btn-primary btn-block" disabled={!value || !shares || !!error} onClick={submit}>
          {error ?? (!value ? 'Enter an amount' : `${mode === 'buy' ? 'Buy' : 'Sell'} ${name}`)}
        </button>
      )}
      {account ? (
        <div className="pm-box">
          <DetailRow label="Avg price" value={value && sharesF ? `${(valueF / sharesF).toFixed(2)} XP / share` : `${fmtPrice(price)} / share`} />
          <DetailRow label={mode === 'buy' ? 'Shares' : 'Shares sold'} value={shares ? fmtXp(shares, { unit: false }) : '—'} />
          {mode === 'buy' && (
            <DetailRow label={`Payout if ${name}`} value={shares ? `${fmtXp(shares)} (+${Math.max(0, (sharesF / valueF - 1) * 100).toFixed(0)}%)` : '—'} tone={shares ? 'success' : undefined} />
          )}
          <DetailRow label="XP after trade" value={xp === undefined ? '—' : fmtXp(mode === 'buy' ? xp - value : xp + value)} />
          {position && (position.yesShares > 0n || position.noShares > 0n) && (
            <DetailRow label="Your shares" value={`${fmtXp(position.yesShares, { unit: false })} Yes · ${fmtXp(position.noShares, { unit: false })} No`} />
          )}
        </div>
      ) : (
        <div className="pm-box" style={{ gap: 4 }}>
          <span className="t-body-strong">Viewing is open to everyone</span>
          <span className="t-body">To stake XP on this market you need a connected wallet. Earn XP from daily quests on PauliSwap.</span>
        </div>
      )}
      <p className="pm-foot">
        Each share pays 1 XP if {name} wins and 0 if it loses. You can sell any time before the market closes. Max slippage {settings.slippageBps / 100}%.
      </p>
    </div>
  );
}

function SettledPanel({ m, position, account }: { m: MarketView; position: Position | undefined; account: string | null }) {
  const { send } = useTx();
  const { openModal } = useApp();
  const claimable =
    position === undefined ? undefined : m.status === RESOLVED ? (m.outcome === YES ? position.yesShares : position.noShares) : m.status === CANCELLED ? (position.yesShares + position.noShares) / 2n : 0n;
  const claim = () =>
    send({
      title: m.status === CANCELLED ? 'Claim XP' : 'Claim winnings',
      verb: 'claim',
      activity: `Claimed on #${m.id}`,
      successTitle: 'Claim confirmed',
      successText: `${fmtXp(claimable)} added to your balance.`,
      build: () => ({ to: PREDICT.market, method: predictMarket().methods.claim(m.id) }),
    });
  const title = m.status === RESOLVED ? `${m.outcome === YES ? 'Yes' : 'No'} won` : m.status === CANCELLED ? 'Market cancelled' : 'Trading closed';
  const body =
    m.status === RESOLVED
      ? 'Winning shares redeem for 1 XP each.'
      : m.status === CANCELLED
        ? 'Every share, Yes or No, pays 0.5 XP.'
        : 'The market is past its close time. Claims open once the admin resolves it.';
  return (
    <div className="pm-trade">
      <div className="pm-box">
        <div className="row">
          <span className="t-heading">{title}</span>
          {m.status === RESOLVED && <Badge tone={m.outcome === YES ? 'success' : 'alert'}>Resolved</Badge>}
          {m.status === OPEN && <Badge tone="warning">Awaiting result</Badge>}
        </div>
        <span className="t-body">{body}</span>
        {account && position && (
          <>
            <DetailRow label="Your Yes shares" value={fmtXp(position.yesShares, { unit: false })} />
            <DetailRow label="Your No shares" value={fmtXp(position.noShares, { unit: false })} />
            <DetailRow label="Claimable" value={fmtXp(claimable)} tone={claimable ? 'success' : undefined} />
          </>
        )}
      </div>
      {!account ? (
        <button className="btn btn-lg btn-primary btn-block" onClick={() => openModal('connect')}>
          Connect wallet
        </button>
      ) : m.status !== OPEN ? (
        <button className="btn btn-lg btn-primary btn-block" disabled={!claimable} onClick={claim}>
          {claimable ? `Claim ${fmtXp(claimable)}` : 'Nothing to claim'}
        </button>
      ) : null}
    </div>
  );
}
