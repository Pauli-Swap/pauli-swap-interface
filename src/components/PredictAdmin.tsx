import { useState } from 'react';
import { PREDICT } from '../config';
import { MarketView, useSeason } from '../hooks/predict';
import { predictMarket } from '../lib/chain';
import { parseUnits } from '../lib/format';
import { fmtXp, NO, OPEN, Outcome, XP_DECIMALS, YES } from '../lib/predict';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { dateLabel, utcTime } from './predict';
import { Badge, DetailRow, Modal } from './ui';

/// Owner-only tools. They render only for PredictMarket.owner() (the caller
/// checks useIsMarketOwner); the contract enforces the same rule with
/// "PM: owner", so these are a convenience, not the access control.

const DEFAULT_LIQUIDITY = '100';

/// "New market" in the Markets bar, opening the createMarket form.
export function NewMarketButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-md btn-primary" onClick={() => setOpen(true)}>
        New market
      </button>
      {open && <NewMarketModal onClose={() => setOpen(false)} />}
    </>
  );
}

// <input type="datetime-local"> has no zone; every Predict date is shown in
// UTC, so the field is read as UTC too.
const toInput = (t: number) => new Date(t * 1000).toISOString().slice(0, 16);
const fromInput = (v: string) => (v ? Math.floor(Date.parse(`${v}:00Z`) / 1000) : NaN);

function NewMarketModal({ onClose }: { onClose: () => void }) {
  const { clock } = useApp();
  const season = useSeason();
  const { send } = useTx();
  const now = clock.latestTime;
  const [question, setQuestion] = useState('');
  const [close, setClose] = useState(() => toInput(Math.ceil((now + 3 * 86400) / 3600) * 3600));
  const [liquidity, setLiquidity] = useState(DEFAULT_LIQUIDITY);

  const closeTime = fromInput(close);
  const seed = parseUnits(liquidity, XP_DECIMALS) ?? 0n;
  let error: string | null = null;
  if (!question.trim()) error = 'Enter a question';
  else if (!Number.isFinite(closeTime)) error = 'Pick a close time';
  else if (closeTime <= now) error = 'Close time is in the past';
  else if (season && closeTime > season.endsAt) error = `Must close by ${dateLabel(season.endsAt)} (season end)`;
  else if (!seed) error = 'Enter the seed liquidity';

  const submit = () =>
    send({
      title: 'Create market',
      verb: 'create',
      activity: `Created market "${question.trim()}"`,
      successTitle: 'Market created',
      successText: `Closes ${dateLabel(closeTime)} · ${utcTime(closeTime)}, seeded with ${fmtXp(seed)}.`,
      build: () => ({ to: PREDICT.market, method: predictMarket().methods.createMarket(question.trim(), closeTime, seed) }),
    }).then((ok) => ok && onClose());

  return (
    <Modal title="New market" onClose={onClose} width={480}>
      <div className="col" style={{ gap: 12 }}>
        <span className="t-body-strong">Question</span>
        <label className="search-field">
          <input autoFocus placeholder="Will … happen by …?" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} />
        </label>
        <span className="t-body-strong">Closes (UTC)</span>
        <label className="search-field">
          <input type="datetime-local" value={close} onChange={(e) => setClose(e.target.value)} />
        </label>
        <span className="t-body-strong">Seed liquidity (XP)</span>
        <label className="search-field">
          <input inputMode="decimal" value={liquidity} onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setLiquidity(e.target.value)} />
        </label>
        <div className="pm-box">
          <DetailRow label="Opening price" value="0.50 XP Yes · 0.50 XP No" />
          {season && <DetailRow label="Season ends" value={`${dateLabel(season.endsAt)} · ${utcTime(season.endsAt)}`} />}
          <span className="t-body">The seed is not taken from any wallet: it caps how much XP the market can pay out beyond what traders put in.</span>
        </div>
        <button className="btn btn-lg btn-primary btn-block" disabled={!!error} onClick={submit}>
          {error ?? 'Create market'}
        </button>
      </div>
    </Modal>
  );
}

/// Resolve / cancel block under the trade panel. Resolve is only offered
/// once the market is past closeTime ("PM: not closed"); cancel works any
/// time the market is open.
export function MarketAdmin({ m }: { m: MarketView }) {
  const { clock } = useApp();
  const { send } = useTx();
  if (m.status !== OPEN) return null;
  const closed = m.closeTime <= clock.latestTime;

  const resolve = (outcome: Outcome) => {
    const name = outcome === YES ? 'Yes' : 'No';
    if (!window.confirm(`Resolve market #${m.id} as ${name}? This cannot be undone.`)) return;
    send({
      title: `Resolve ${name}`,
      verb: 'resolve',
      activity: `Resolved #${m.id} ${name}`,
      successTitle: 'Market resolved',
      successText: `#${m.id} settled ${name}. Winning shares can be claimed now.`,
      build: () => ({ to: PREDICT.market, method: predictMarket().methods.resolve(m.id, outcome) }),
    });
  };
  const cancel = () => {
    if (!window.confirm(`Cancel market #${m.id}? Every share then pays 0.5 XP. This cannot be undone.`)) return;
    send({
      title: 'Cancel market',
      verb: 'cancel',
      activity: `Cancelled #${m.id}`,
      successTitle: 'Market cancelled',
      successText: `#${m.id} is void; every share claims 0.5 XP.`,
      build: () => ({ to: PREDICT.market, method: predictMarket().methods.cancel(m.id) }),
    });
  };

  return (
    <div className="pm-box">
      <div className="row">
        <span className="t-heading">Admin</span>
        <Badge tone="quantum">Owner</Badge>
      </div>
      <span className="t-body">{closed ? 'Trading has closed. Pick the outcome that happened.' : `Resolve opens at ${dateLabel(m.closeTime)} · ${utcTime(m.closeTime)}.`}</span>
      {closed && (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-md btn-secondary grow" onClick={() => resolve(YES)}>
            Resolve Yes
          </button>
          <button className="btn btn-md btn-secondary grow" onClick={() => resolve(NO)}>
            Resolve No
          </button>
        </div>
      )}
      <button className="btn btn-md btn-danger btn-block" onClick={cancel}>
        Cancel market
      </button>
    </div>
  );
}
