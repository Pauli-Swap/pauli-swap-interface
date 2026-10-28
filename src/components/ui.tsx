import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CHAIN } from '../config';
import { shortAddress } from '../lib/chain';
import { isWqrl, Token } from '../lib/tokens';
import { feeLabel } from '../lib/v3';
import { ICONS, IconName } from './icons';

export function Icon({ name, size = 20, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg
      className={className}
      style={{ flex: 'none', ...style }}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

/// Two-letter monogram, as on the Figma token marks (ACRN → AC, QUSD → QU).
export const monogram = (t: Token) => (t.symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?').toUpperCase();

/// Logo asset for a token, when one exists. Only QRL and WQRL ship one today;
/// add entries here as token artwork arrives.
export function tokenAsset(token: Token): string | undefined {
  if (token.native || isWqrl(token)) return '/qrl-logo.png';
  return undefined;
}

/// Token icon (86:346): a token with a logo asset shows the logo at full size
/// with no disc; every other token gets a quantum-blue monogram on a disc.
export function TokenIcon({ token, size = 32 }: { token: Token | null | undefined; size?: number }) {
  const style: CSSProperties = { width: size, height: size, fontSize: Math.max(8, size * 0.4375), lineHeight: 1 };
  if (!token) return <span className="token-icon neutral" style={style}>?</span>;
  const asset = tokenAsset(token);
  // The logo has no disc of its own, so it sits inset in its slot: same
  // footprint as a monogram disc, without touching the pill or row around it.
  if (asset)
    return (
      <span className="token-img" style={{ width: size, height: size }} title={token.native ? 'QRL' : token.address}>
        <img src={asset} alt="" width={Math.round(size * 0.84)} height={Math.round(size * 0.84)} draggable={false} />
      </span>
    );
  return (
    <span className="token-icon" style={style} title={token.address}>
      {monogram(token)}
    </span>
  );
}

/// Pair icon (86:347): two overlapping marks.
export function PairIcon({ a, b, size = 32 }: { a?: Token | null; b?: Token | null; size?: number }) {
  return (
    <span className="pair-icon" style={{ ['--overlap' as string]: `${-Math.round(size * 0.3125)}px` }}>
      <TokenIcon token={a} size={size} />
      <TokenIcon token={b} size={size} />
    </span>
  );
}

export type Tone = 'neutral' | 'quantum' | 'success' | 'warning' | 'alert' | 'qrl';

export const Badge = ({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) => (
  <span className={`badge${tone === 'neutral' ? '' : ` badge-${tone}`}`} title={title}>
    {children}
  </span>
);

/// Version + fee tier badges used on every pool row and header.
export const PoolBadges = ({ version, fee }: { version: 'v2' | 'v3'; fee: number }) => (
  <>
    <Badge tone="quantum">{version.toUpperCase()}</Badge>
    <Badge>{feeLabel(fee)}</Badge>
  </>
);

export function Banner({ tone, title, children }: { tone: 'alert' | 'warning' | 'quantum'; title?: string; children?: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'alert' ? 'alert' : undefined}>
      <Icon name={tone === 'quantum' ? 'info' : 'alert-triangle'} size={20} />
      <div className="col grow" style={{ gap: 2 }}>
        {title && <span className="t-body-strong">{title}</span>}
        {children && <span className="t-body c-2">{children}</span>}
      </div>
    </div>
  );
}

export function DetailRow({ label, value, info, tone }: { label: ReactNode; value: ReactNode; info?: string; tone?: 'success' | 'warning' | 'alert' }) {
  return (
    <div className="detail-row">
      <span className="label">{label}</span>
      {info && (
        <span className="info" title={info}>
          <Icon name="info" size={14} />
        </span>
      )}
      <span className={`value ${tone ? `c-${tone}` : ''}`}>{value}</span>
    </div>
  );
}

export function Stat({ label, value, delta, deltaTone }: { label: ReactNode; value: ReactNode; delta?: ReactNode; deltaTone?: 'up' | 'down' | 'muted' }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value num">{value}</span>
      {delta !== undefined && <span className={`delta ${deltaTone === 'muted' ? '' : deltaTone ?? 'up'}`}>{delta}</span>}
    </div>
  );
}

/// "+3.4%" / "−1.2%" with its tone; undefined when the change is unknown.
export function deltaOf(change: number | null | undefined): { delta?: string; deltaTone?: 'up' | 'down' } {
  if (change === null || change === undefined || !Number.isFinite(change)) return {};
  return { delta: `${change >= 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(1)}%`, deltaTone: change >= 0 ? 'up' : 'down' };
}

/// Pill that slides under the `.on` option of a segmented control; render it
/// as the control's first child. Until it has measured, `.on` keeps its own fill.
export function SegThumb() {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const thumb = ref.current;
    const box = thumb?.parentElement;
    if (!thumb || !box) return;
    let first = true;
    const place = () => {
      const on = box.querySelector<HTMLElement>(':scope > .on');
      if (!on) {
        thumb.style.opacity = '0';
        return;
      }
      // Land in place on mount; slide on every later change.
      thumb.style.transition = first ? 'none' : '';
      thumb.style.opacity = '1';
      thumb.style.width = `${on.offsetWidth}px`;
      thumb.style.height = `${on.offsetHeight}px`;
      thumb.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
      if (!box.classList.contains('has-thumb')) box.classList.add('has-thumb');
      first = false;
    };
    place();
    const mo = new MutationObserver(place);
    mo.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const ro = new ResizeObserver(place);
    ro.observe(box);
    for (const el of Array.from(box.children)) ro.observe(el);
    return () => {
      mo.disconnect();
      ro.disconnect();
      box.classList.remove('has-thumb');
    };
  }, []);
  return <span ref={ref} className="seg-thumb" aria-hidden="true" />;
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
  labels,
  boxed,
  fill,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, ReactNode>>;
  boxed?: boolean;
  fill?: boolean;
}) {
  return (
    <div className={`seg${boxed ? ' boxed' : ''}${fill ? ' fill' : ''}`} role="tablist">
      <SegThumb />
      {options.map((o) => (
        <button key={o} role="tab" aria-selected={o === value} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function IconButton({
  icon,
  label,
  onClick,
  filled,
  size = 20,
  href,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  filled?: boolean;
  size?: number;
  href?: string;
}) {
  if (href)
    return (
      <a className={`icon-btn${filled ? ' filled' : ''}`} href={href} target="_blank" rel="noreferrer" aria-label={label} title={label}>
        <Icon name={icon} size={size} />
      </a>
    );
  return (
    <button className={`icon-btn${filled ? ' filled' : ''}`} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  width = 440,
  center,
  light,
  hideHeader,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  center?: boolean;
  light?: boolean;
  hideHeader?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className={`scrim${center ? ' center' : ''}${light ? ' light' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: width }}>
        {!hideHeader && (
          <div className="modal-header">
            {title && <span className="title">{title}</span>}
            <button className="close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={20} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export const explorerHref = (kind: 'tx' | 'address', value: string) => (CHAIN.explorerUrl ? `${CHAIN.explorerUrl}/${kind}/${value}` : undefined);

/// "View on QRL explorer" — renders nothing while no explorer is configured.
export function ExplorerLink({ hash, address, children }: { hash?: string; address?: string; children?: ReactNode }) {
  const href = hash ? explorerHref('tx', hash) : address ? explorerHref('address', address) : undefined;
  if (!href) return null;
  return (
    <a className="row link t-body-strong" href={href} target="_blank" rel="noreferrer" style={{ gap: 6 }}>
      {children ?? 'View on QRL explorer'}
      <Icon name="external-link" size={16} />
    </a>
  );
}

/// Short address with a copy button, as in the token/pool headers.
export function CopyAddress({ address, size = 4, boxed }: { address: string; size?: number; boxed?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <button className={`copy-addr${boxed ? ' boxed' : ''}`} onClick={copy} title={copied ? 'Copied' : address}>
      <span className="t-num">{shortAddress(address, size)}</span>
      <Icon name={copied ? 'check' : 'copy'} size={14} className={copied ? 'c-success' : 'c-3'} />
    </button>
  );
}

export const Skeleton = ({ w, h = 16, round }: { w: number | string; h?: number; round?: boolean }) => (
  <span className={`skeleton${round ? ' round' : ''}`} style={{ display: 'inline-block', width: w, height: h, flex: 'none' }} />
);

/// Spinner + softly pulsing text for inline "Loading…" states.
export function Busy({ children, size = 16, className = '' }: { children?: ReactNode; size?: number; className?: string }) {
  return (
    <span className={`busy ${className}`} role="status">
      <Icon name="loader" size={size} className="spin c-quantum" />
      {children && <span className="busy-text">{children}</span>}
    </span>
  );
}

export function Empty({ icon = 'info', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  const loading = icon === 'loader';
  return (
    <div className={`empty-state${loading ? ' loading' : ''}`} role={loading ? 'status' : undefined}>
      <Icon name={icon} size={28} className={loading ? 'spin c-quantum' : undefined} />
      <span className="t-heading c-1">{title}</span>
      {children && <span className="t-body c-3">{children}</span>}
    </div>
  );
}

export function Crumbs({ items }: { items: { label: ReactNode; href?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i} className="row" style={{ gap: 6 }}>
          {i > 0 && <Icon name="chevron-right" size={14} />}
          {it.href ? <a href={it.href}>{it.label}</a> : <span className="here">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/// Amount panel (89:181): label, amount input, token selector, meta row with
/// balance and MAX. Used by swap, deposit and wrap forms.
export function AmountPanel({
  label,
  token,
  symbol,
  amount,
  onAmount,
  onSelect,
  sub,
  balance,
  onMax,
  readOnly,
  focus,
  error,
  loading,
}: {
  label: string;
  token: Token | null;
  symbol?: string;
  amount: string;
  onAmount?: (v: string) => void;
  onSelect?: () => void;
  sub?: ReactNode;
  balance?: string;
  onMax?: () => void;
  readOnly?: boolean;
  focus?: boolean;
  error?: boolean;
  /// The amount is being quoted: the input shimmers until it lands.
  loading?: boolean;
}) {
  const shrink = amount.length > 12 ? Math.max(18, 30 - (amount.length - 12) * 1.6) : undefined;
  return (
    <div className={`amount-panel${focus ? ' focus' : ''}${error ? ' error' : ''}${loading ? ' loading' : ''}`} aria-busy={loading || undefined}>
      <span className="t-label c-3">{label}</span>
      <div className="amount-row">
        <input
          inputMode="decimal"
          placeholder="0"
          value={amount}
          readOnly={readOnly}
          aria-label={`${label} amount`}
          style={shrink ? { fontSize: shrink } : undefined}
          onChange={(e) => {
            const v = e.target.value.replace(',', '.');
            if (/^\d*\.?\d*$/.test(v)) onAmount?.(v);
          }}
        />
        <TokenSelect token={token} symbol={symbol} onClick={onSelect} />
      </div>
      {(sub !== undefined || balance !== undefined || onMax) && (
      <div className="meta-row">
        <span>{sub}</span>
        {balance !== undefined && <span className="nowrap num">Balance {balance}</span>}
        {onMax && (
          <button className="max-chip" onClick={onMax}>
            MAX
          </button>
        )}
      </div>
      )}
    </div>
  );
}

/// Token selector (88:198); the empty state is the primary blue.
export function TokenSelect({ token, symbol, onClick }: { token: Token | null; symbol?: string; onClick?: () => void }) {
  if (!token)
    return (
      <button className="token-select empty" onClick={onClick}>
        Select token
        <Icon name="chevron-down" size={20} />
      </button>
    );
  const body = (
    <>
      <TokenIcon token={token} size={28} />
      <span>{symbol ?? token.symbol}</span>
      {onClick && <Icon name="chevron-down" size={20} className="c-2" />}
    </>
  );
  return onClick ? (
    <button className="token-select" onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className="token-select" style={{ paddingRight: 12 }}>
      {body}
    </span>
  );
}
