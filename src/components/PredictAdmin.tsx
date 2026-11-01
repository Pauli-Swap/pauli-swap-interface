import { useMemo, useState } from 'react';
import { PREDICT } from '../config';
import { MarketView, useSeason } from '../hooks/predict';
import { predictMarket, shortAddress } from '../lib/chain';
import { parseUnits } from '../lib/format';
import { DecodedEvent } from '../lib/logs';
import { batches, fmtChance, fmtXp, Holding, holdings, MARKET_RULES, NO, OPEN, Outcome, payees, XP_DECIMALS, YES } from '../lib/predict';
import { href } from '../lib/router';
import { useApp } from '../state/app';
import { useTx } from '../state/tx';
import { useWallet } from '../state/wallet';
import { dateLabel, longSpan, utcTime } from './predict';
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

const outcomeName = (o: Outcome | null) => (o === null ? 'Cancelled' : o === YES ? 'Yes' : 'No');
const wallets = (n: number) => `${n} wallet${n === 1 ? '' : 's'}`;

/// Settle for every wallet in `users`, SETTLE_BATCH at a time. The attester
/// pays the same wallets a few blocks later when this is not sent; settle
/// skips anyone already paid, so the two never pay twice.
export function useSettle() {
  const { send } = useTx();
  return async (id: number, users: string[], prior: string[] = []) => {
    const chunks = batches(users);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const title = chunks.length > 1 ? `Pay holders ${i + 1}/${chunks.length}` : 'Pay holders';
      const ok = await send({
        title,
        verb: 'payout',
        activity: `Paid ${wallets(chunk.length)} on #${id}`,
        successTitle: 'Holders paid',
        successText: `${wallets(chunk.length)} received their XP.`,
        prior,
        build: () => ({ to: PREDICT.market, method: predictMarket().methods.settle(id, chunk) }),
      });
      if (!ok) return false;
      prior = [...prior, title];
    }
    return true;
  };
}

/// Resolve (or cancel, outcome null), then settle every wallet it pays.
function useResolve() {
  const { send } = useTx();
  const settle = useSettle();
  return async (m: MarketView, outcome: Outcome | null, rows: Holding[]) => {
    const name = outcomeName(outcome);
    const title = outcome === null ? 'Cancel market' : `Resolve ${name}`;
    const ok = await send({
      title,
      verb: outcome === null ? 'cancel' : 'resolve',
      activity: outcome === null ? `Cancelled #${m.id}` : `Resolved #${m.id} ${name}`,
      successTitle: outcome === null ? 'Market cancelled' : 'Market resolved',
      successText: outcome === null ? `#${m.id} is void; every share pays 0.5 XP.` : `#${m.id} resolved ${name}.`,
      build: () => ({ to: PREDICT.market, method: outcome === null ? predictMarket().methods.cancel(m.id) : predictMarket().methods.resolve(m.id, outcome) }),
    });
    if (!ok) return false;
    return settle(m.id, payees(rows, outcome).users, [title]);
  };
}

/// Owner panel in place of the trade panel once a market is past closeTime
/// and still open (Predict · Market · Resolve proposal, 2026-11-01).
export function ResolvePanel({ m, log }: { m: MarketView; log: DecodedEvent[] | null }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirm, setConfirm] = useState<Outcome | 'cancel' | null>(null);
  const rows = useMemo(() => holdings(log ?? [], m.id), [log, m.id]);
  const rule = MARKET_RULES[m.question];
  return (
    <div className="pm-trade">
      <div className="pm-box">
        <div className="row">
          <span className="t-heading">Resolve market</span>
          <Badge tone="quantum">Owner</Badge>
        </div>
        <span className="t-body">
          Trading closed {dateLabel(m.closeTime)} · {utcTime(m.closeTime)}. Check the rule against its source, then pick what happened.
        </span>
        {rule && (
          <div className="pm-rule">
            <span className="t-caption c-3">How to resolve</span>
            <span className="t-body-strong">{rule.how}</span>
            <DetailRow label="Source" value={rule.source} />
          </div>
        )}
        <span className="t-caption c-3">Outcome</span>
        <div className="pm-sides">
          {([YES, NO] as Outcome[]).map((o) => {
            const p = payees(rows, o);
            return (
              <button key={o} className={`pm-side pm-pick ${o === YES ? 'yes' : 'no'}${outcome === o ? ' on' : ''}`} onClick={() => setOutcome(o)}>
                <span className="name">{outcomeName(o)}</span>
                <span className="sub">
                  pays {wallets(p.users.length)} · {fmtXp(p.xp)}
                </span>
              </button>
            );
          })}
        </div>
        <button className="btn btn-lg btn-primary btn-block" disabled={outcome === null || !log} onClick={() => outcome !== null && setConfirm(outcome)}>
          {outcome === null ? 'Pick an outcome' : `Review: resolve ${outcomeName(outcome)}`}
        </button>
        <div className="pm-box">
          <DetailRow label="Payout" value="Sent right after the resolve" />
          <DetailRow label="Undo" value="Not possible" />
        </div>
      </div>
      <CancelBox onCancel={() => setConfirm('cancel')} />
      {confirm !== null && <ConfirmResolve m={m} outcome={confirm === 'cancel' ? null : confirm} rows={rows} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function CancelBox({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="pm-box">
      <div className="row">
        <span className="t-body-strong grow">Cancel market instead</span>
        <button className="btn btn-sm btn-danger" onClick={onCancel}>
          Cancel market
        </button>
      </div>
      <span className="t-caption c-3">Use when the question cannot be answered. Every share, Yes or No, then pays 0.5 XP.</span>
    </div>
  );
}

function ConfirmResolve({ m, outcome, rows, onClose }: { m: MarketView; outcome: Outcome | null; rows: Holding[]; onClose: () => void }) {
  const { account } = useWallet();
  const run = useResolve();
  const [checked, setChecked] = useState(false);
  const paid = payees(rows, outcome);
  const name = outcomeName(outcome);
  const txs = 1 + batches(paid.users).length;
  const submit = () => {
    onClose();
    run(m, outcome, rows);
  };
  return (
    <Modal title={outcome === null ? `Cancel #${m.id}?` : `Resolve #${m.id} as ${name}?`} onClose={onClose} width={480}>
      <div className="col" style={{ gap: 16 }}>
        <span className="t-body c-2">{m.question}</span>
        <div className="pm-box">
          <DetailRow label="Outcome" value={<Badge tone={outcome === null ? 'neutral' : outcome === YES ? 'success' : 'alert'}>{name}</Badge>} />
          <DetailRow label="Wallets paid" value={wallets(paid.users.length)} />
          <DetailRow label="XP paid out" value={fmtXp(paid.xp)} />
          <DetailRow label="Transactions" value={txs === 1 ? '1 (nobody to pay)' : `${txs}: ${outcome === null ? 'cancel' : 'resolve'}, then pay holders`} />
          {account && <DetailRow label="Signed by" value={`Owner ${shortAddress(account)}`} />}
        </div>
        <div className="pm-warn">
          <span className="t-body-strong">This cannot be undone</span>
          <span className="t-caption">The contract has no dispute or appeal step. Once sent, holders are paid and the market closes for good.</span>
        </div>
        <label className="pm-check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span className="t-body">{outcome === null ? 'This question cannot be answered fairly' : 'I checked the result against the rule'}</span>
        </label>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-lg btn-secondary grow" onClick={onClose}>
            Back
          </button>
          <button className={`btn btn-lg ${outcome === null ? 'btn-danger' : 'btn-primary'} grow`} disabled={!checked} onClick={submit}>
            {outcome === null ? 'Cancel market' : `Resolve ${name}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/// Cancel block under the trade panel while the market still trades; resolve
/// waits for closeTime ("PM: not closed") and then gets ResolvePanel.
export function MarketAdmin({ m, log }: { m: MarketView; log: DecodedEvent[] | null }) {
  const [confirm, setConfirm] = useState(false);
  const rows = useMemo(() => holdings(log ?? [], m.id), [log, m.id]);
  if (m.status !== OPEN) return null;
  return (
    <div className="pm-box">
      <div className="row">
        <span className="t-heading">Admin</span>
        <Badge tone="quantum">Owner</Badge>
      </div>
      <span className="t-body">
        Resolve opens at {dateLabel(m.closeTime)} · {utcTime(m.closeTime)}.
      </span>
      <button className="btn btn-md btn-danger btn-block" disabled={!log} onClick={() => setConfirm(true)}>
        Cancel market
      </button>
      {confirm && <ConfirmResolve m={m} outcome={null} rows={rows} onClose={() => setConfirm(false)} />}
    </div>
  );
}

/// Markets past closeTime that still wait for the owner, on the Markets tab.
export function OwnerQueue({ markets, now }: { markets: MarketView[] | null; now: number }) {
  const due = (markets ?? []).filter((m) => m.status === OPEN && m.closeTime <= now).sort((a, b) => a.closeTime - b.closeTime);
  if (!due.length) return null;
  return (
    <div className="pm-card pm-queue">
      <div className="pm-card-head">
        <div className="row" style={{ gap: 8 }}>
          <span className="t-heading">Awaiting your result</span>
          <Badge tone="warning">{due.length}</Badge>
        </div>
        <Badge tone="quantum">Owner</Badge>
      </div>
      <span className="t-body c-3">Only the market owner sees this. Holders are paid right after you resolve.</span>
      {due.map((m) => (
        <a key={m.id} className="pm-queue-row" href={href({ page: 'predictMarket', id: String(m.id) })}>
          <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
            <span className="t-body-strong">{m.question}</span>
            <span className="t-caption c-3">
              #{m.id} · Closed {dateLabel(m.closeTime)} · {utcTime(m.closeTime)} · {longSpan(now - m.closeTime)} ago · last {fmtChance(m.price)} Yes · {m.traders} traders
            </span>
          </span>
          <span className="btn btn-md btn-primary">Resolve</span>
        </a>
      ))}
    </div>
  );
}
