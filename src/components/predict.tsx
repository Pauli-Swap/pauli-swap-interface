import { ReactNode, useEffect, useState } from 'react';
import { CHAIN } from '../config';
import { fmtXp } from '../lib/predict';
import { href, PredictTab } from '../lib/router';
import { Token } from '../lib/tokens';
import { useApp } from '../state/app';
import { Empty, Icon } from './ui';
import '../styles/predict.css';

/// Stand-in token for the amount panel and token marks; XP is a ledger
/// balance in PauliPredictXP, not an SQRC-TF1 token.
export const XP_TOKEN: Token = { address: 'xp', symbol: 'XP', name: 'Predict XP', decimals: 18 };

export const PREDICT_RULE = 'Trade Yes and No shares on real-world outcomes with XP. Buy and sell until a market closes; a winning share then pays 1 XP and a losing share 0.';

const TABS: { key: PredictTab; label: string }[] = [
  { key: 'markets', label: 'Markets' },
  { key: 'quests', label: 'Quests' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'rewards', label: 'Rewards' },
];

/// Predict/Subnav (112:794): text tabs with a quantum underline, the open
/// quest count on Quests, and the XP chip (112:793) at the end.
export function Subnav({ tab, questsLeft, xp, connected }: { tab: PredictTab; questsLeft?: number; xp?: bigint; connected: boolean }) {
  return (
    <nav className="pm-subnav">
      {TABS.map((t) => (
        <a key={t.key} href={href({ page: 'predict', tab: t.key })} className={tab === t.key ? 'on' : ''} aria-current={tab === t.key ? 'page' : undefined}>
          {t.label}
          {t.key === 'quests' && !!questsLeft && <span className="badge badge-quantum">{questsLeft} left</span>}
        </a>
      ))}
      <span className="grow" />
      <span className={`xp-chip${connected ? '' : ' off'}`} title="Your XP this season">
        <Icon name="star" size={16} className={connected ? 'c-quantum' : undefined} />
        <span className="num">{connected ? fmtXp(xp) : '— XP'}</span>
      </span>
    </nav>
  );
}

export function PredictTitle() {
  return (
    <div className="page-title">
      <h1>Predict</h1>
      <p>{PREDICT_RULE}</p>
    </div>
  );
}

/// Guest banner (114:2449): QRL-orange title, white body, Connect wallet.
export function GuestBanner() {
  const { openModal } = useApp();
  return (
    <div className="pm-guest card">
      <div className="col grow" style={{ gap: 2 }}>
        <span className="t-body-strong c-qrl">You are browsing as a guest</span>
        <span className="t-body c-1">Anyone can view markets. Connect a wallet to stake XP, do daily quests and join the leaderboard.</span>
      </div>
      <button className="btn btn-md btn-primary" onClick={() => openModal('connect')}>
        Connect wallet
      </button>
    </div>
  );
}

/// PM/Outcome button (106:1454): Yes in success green, No in alert red.
export function OutcomeLink({ side, price, to, className = '' }: { side: 'yes' | 'no'; price: string; to: string; className?: string }) {
  return (
    <a className={`pm-outcome ${side} ${className}`} href={to}>
      {side === 'yes' ? 'Yes' : 'No'} {price}
    </a>
  );
}

export function NotDeployed() {
  return (
    <Empty icon="info" title={`Predict is not deployed on ${CHAIN.name} yet`}>
      PauliPredictXP and PredictMarket have no deployment on chain {CHAIN.id}. After they are deployed, run npm run sync:predict and rebuild.
    </Empty>
  );
}

/// Seconds until `target`, ticking once a second.
export function useCountdown(target: number | undefined) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  return target === undefined ? undefined : Math.max(0, Math.floor(target - now));
}

const pad = (n: number) => String(n).padStart(2, '0');
/// "06:12:40"
export const clock = (s: number) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
/// "12d 04h", "5h 12m", "48m"
export function span(s: number) {
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${pad(Math.floor((s % 86400) / 3600))}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
  return `${Math.max(0, Math.ceil(s / 60))}m`;
}
/// "34 days", "5 hours", "12 min"
export function longSpan(s: number) {
  if (s >= 2 * 86400) return `${Math.floor(s / 86400)} days`;
  if (s >= 2 * 3600) return `${Math.floor(s / 3600)} hours`;
  return `${Math.max(1, Math.ceil(s / 60))} min`;
}

export const dateLabel = (t: number) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const shortDate = (t: number) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const utcTime = (t: number) => new Date(t * 1000).toISOString().slice(11, 16) + ' UTC';

/// Two-character mark for a wallet, as on the leaderboard rows.
export const addressMark = (address: string) => address.slice(1, 3).toUpperCase();

export function StatCard({ children }: { children: ReactNode }) {
  return <div className="card pm-stat">{children}</div>;
}

/// Gold, silver and bronze medal for ranks 1 to 3 (public/medals); `size` is
/// the height, the ribbon makes them a little taller than wide.
/// The gold ribbon is longer, so at list sizes rank 1 is drawn 26/24 taller
/// to keep its disc level with 2 and 3; the negative margin keeps the layout
/// box at `size`. The podium sizes rank 1 itself.
export function RankMedal({ rank, size = 24 }: { rank: 1 | 2 | 3; size?: number }) {
  const h = rank === 1 && size <= 24 ? Math.round((size * 26) / 24) : size;
  const bleed = (size - h) / 2;
  return (
    <img
      src={`/medals/rank-${rank}.png`}
      height={h}
      alt={`Rank ${rank}`}
      draggable={false}
      style={{ flex: 'none', width: 'auto', margin: bleed ? `${bleed}px` : undefined }}
    />
  );
}

export const isMedal = (rank: number): rank is 1 | 2 | 3 => rank >= 1 && rank <= 3;
