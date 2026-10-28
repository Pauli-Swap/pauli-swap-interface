import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_SLIPPAGE_BPS } from '../config';
import { useApp } from '../state/app';
import { Icon, Seg, Toggle } from './ui';

/// Settings icon button (Icon button · Ghost) that opens the swap settings
/// popover (91:769). While open, a light scrim covers the page and the button
/// stays above it in its Filled state.
export function SettingsButton({ title = 'Swap settings', routing = true }: { title?: string; routing?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div style={{ position: 'relative', zIndex: open ? 61 : undefined }}>
      <button className={`icon-btn${open ? ' filled' : ''}`} onClick={() => setOpen((o) => !o)} aria-label={title} aria-expanded={open} title={title}>
        <Icon name="settings" size={20} />
      </button>
      {open && createPortal(<div className="scrim light" style={{ zIndex: 60 }} onMouseDown={() => setOpen(false)} />, document.body)}
      {open && <SettingsPopover title={title} routing={routing} />}
    </div>
  );
}

function SettingsPopover({ title, routing }: { title: string; routing: boolean }) {
  const { settings, setSettings } = useApp();
  const [slippage, setSlippage] = useState((settings.slippageBps / 100).toFixed(2));
  const [deadline, setDeadline] = useState(String(settings.deadlineMin));
  const n = Number(slippage);
  const invalid = slippage !== '' && (!(n > 0) || n >= 50);
  const high = !settings.slippageAuto && settings.slippageBps > 300;

  return (
    <div className="popover settings-pop" role="dialog" aria-label={title}>
      <span className="t-heading">{title}</span>
      <div className="col" style={{ gap: 8 }}>
        <span className="row t-body-strong c-2" style={{ gap: 6 }}>
          Max slippage
          <span className="c-3 center" title="Your transaction reverts if the price moves against you by more than this.">
            <Icon name="info" size={14} />
          </span>
        </span>
        <div className="row">
          <Seg
            boxed
            options={['auto', 'custom'] as const}
            labels={{ auto: 'Auto', custom: 'Custom' }}
            value={settings.slippageAuto ? 'auto' : 'custom'}
            onChange={(v) => {
              if (v === 'auto') {
                setSlippage((DEFAULT_SLIPPAGE_BPS / 100).toFixed(2));
                setSettings({ ...settings, slippageAuto: true, slippageBps: DEFAULT_SLIPPAGE_BPS });
              } else setSettings({ ...settings, slippageAuto: false });
            }}
          />
          <label className={`text-input grow${!settings.slippageAuto ? ' focus' : ''}${invalid ? ' error' : ''}`}>
            <input
              inputMode="decimal"
              value={slippage}
              onChange={(e) => {
                const v = e.target.value.replace(',', '.');
                if (!/^\d*\.?\d{0,2}$/.test(v)) return;
                setSlippage(v);
                const x = Number(v);
                if (v && x > 0 && x < 50) setSettings({ ...settings, slippageAuto: false, slippageBps: Math.round(x * 100) });
              }}
            />
            <span className="c-3">%</span>
          </label>
        </div>
        {invalid && <span className="t-caption c-alert">Enter a value between 0.01 and 49.99.</span>}
        {high && <span className="t-caption c-warning">High slippage: the trade may be front-run.</span>}
      </div>
      <div className="col" style={{ gap: 8 }}>
        <span className="row t-body-strong c-2" style={{ gap: 6 }}>
          Transaction deadline
          <span className="c-3 center" title="The transaction reverts if it is still pending after this long.">
            <Icon name="info" size={14} />
          </span>
        </span>
        <label className="text-input">
          <input
            inputMode="numeric"
            value={deadline}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 4);
              setDeadline(v);
              if (Number(v) > 0) setSettings({ ...settings, deadlineMin: Number(v) });
            }}
          />
          <span className="c-3 t-body">minutes</span>
        </label>
      </div>
      {routing && (
        <>
          <hr className="divider" />
          <span className="t-body-strong c-2">Routing</span>
          <RoutingRow
            title="V3 pools"
            sub="Concentrated liquidity"
            on={settings.useV3}
            onChange={(v) => setSettings({ ...settings, useV3: v, useV2: v ? settings.useV2 : true })}
          />
          <RoutingRow
            title="V2 pools"
            sub="Constant product"
            on={settings.useV2}
            onChange={(v) => setSettings({ ...settings, useV2: v, useV3: v ? settings.useV3 : true })}
          />
          <div className="note-box" style={{ background: 'var(--quantum-bg)', color: 'var(--text-secondary)' }}>
            <Icon name="info" size={16} className="c-quantum" />
            <span>PauliSwap quotes both protocols and routes through the better price.</span>
          </div>
        </>
      )}
    </div>
  );
}

function RoutingRow({ title, sub, on, onChange }: { title: string; sub: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row" style={{ gap: 12 }}>
      <div className="col grow" style={{ gap: 2 }}>
        <span className="t-body-strong">{title}</span>
        <span className="t-caption c-3">{sub}</span>
      </div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  );
}
