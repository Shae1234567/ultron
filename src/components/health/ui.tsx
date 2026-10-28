import type { ReactNode } from 'react';

/*
 * The Health app's small parts, in Ultron's lettering and the council's pixel framing:
 * section labels trailing off in a hairline, 1-N scales you tap, chip pickers, number
 * steppers and segmented bars that fill like the council's sleep blocks.
 */

export function Sec({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="hl-sec">
      <span>{children}</span>
      <i />
      {right}
    </div>
  );
}

export function Card({ children, className = '', onClick, label }: { children: ReactNode; className?: string; onClick?: () => void; label?: string }) {
  return onClick ? (
    <div className={`hl-card hl-card--go ${className}`} role="button" tabIndex={0} aria-label={label} onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>{children}</div>
  ) : <div className={`hl-card ${className}`}>{children}</div>;
}

/** Tap a number from `from` to `to`. Optional words under the ends, and a word for the picked one. */
export function Scale({ value, onChange, from = 1, to = 5, low, high, words, label }: {
  value?: number; onChange: (n: number) => void; from?: number; to?: number; low?: string; high?: string; words?: Record<number, string>; label: string;
}) {
  const nums = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <div className="hl-scale" role="radiogroup" aria-label={label}>
      <div className="hl-scale__row">
        {nums.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} className={`hl-scale__n${value === n ? ' is-on' : ''}${value !== undefined && n < value ? ' is-under' : ''}`}
            onClick={() => onChange(n)}>{n}</button>
        ))}
      </div>
      {(low || high || (value !== undefined && words?.[value])) && (
        <div className="hl-scale__ends">
          <span>{low}</span>
          <b>{value !== undefined ? words?.[value] ?? '' : ''}</b>
          <span>{high}</span>
        </div>
      )}
    </div>
  );
}

export function Chips<T extends string>({ options, value, onChange, label, multi }: {
  options: { id: T; text: string }[]; value: T | T[] | undefined; onChange: (v: T) => void; label: string; multi?: boolean;
}) {
  const on = (id: T) => (Array.isArray(value) ? value.includes(id) : value === id);
  return (
    <div className="hl-chips" role={multi ? 'group' : 'radiogroup'} aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role={multi ? 'checkbox' : 'radio'} aria-checked={on(o.id)} className={`hl-chip${on(o.id) ? ' is-on' : ''}`} onClick={() => onChange(o.id)}>
          {o.text}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, step = 5, min = 0, max = 600, unit, presets, label }: {
  value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; unit?: string; presets?: number[]; label: string;
}) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, Math.round(n))));
  return (
    <div className="hl-stepper">
      <button type="button" className="hl-stepper__b" aria-label={`Less ${label}`} onClick={() => set(value - step)}>-</button>
      <input className="hl-stepper__v" inputMode="numeric" aria-label={label} value={Number.isFinite(value) ? value : ''}
        onChange={(e) => { const n = Number(e.target.value.replace(/[^\d.]/g, '')); set(Number.isFinite(n) ? n : min); }} />
      {unit && <span className="hl-stepper__u">{unit}</span>}
      <button type="button" className="hl-stepper__b" aria-label={`More ${label}`} onClick={() => set(value + step)}>+</button>
      {presets && (
        <span className="hl-stepper__p">
          {presets.map((p) => <button key={p} type="button" className={`hl-mini${p === value ? ' is-on' : ''}`} onClick={() => set(p)}>{p}</button>)}
        </span>
      )}
    </div>
  );
}

/** A bar of N segments filling to a share of a target; past 100% the extra glows. */
export function Segments({ share, n = 10, label, tone }: { share: number; n?: number; label?: string; tone?: 'low' | 'ok' | 'warn' }) {
  const filled = Math.max(0, Math.min(n, Math.round(share * n)));
  return (
    <div className={`hl-seg${tone ? ` hl-seg--${tone}` : ''}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < filled ? 'on' : ''} style={{ ['--i' as string]: i }} />)}
      {share > 1.05 && <b className="hl-seg__over">+</b>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="hl-field">
      <span className="hl-field__l">{label}</span>
      {children}
      {hint && <span className="hl-field__h">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="hl-empty">{children}</div>;
}

export const EFFORT_WORDS: Record<number, string> = {
  1: 'very easy', 2: 'easy', 3: 'easy', 4: 'steady', 5: 'moderate', 6: 'moderate', 7: 'hard', 8: 'hard', 9: 'very hard', 10: 'everything you had',
};
export const ENERGY_WORDS: Record<number, string> = { 1: 'flat', 2: 'low', 3: 'okay', 4: 'good', 5: 'buzzing' };
export const SORE_WORDS: Record<number, string> = { 1: 'fresh', 2: 'a bit', 3: 'sore', 4: 'very sore', 5: 'can barely move' };
export const QUALITY_WORDS: Record<number, string> = { 1: 'awful', 2: 'poor', 3: 'okay', 4: 'good', 5: 'great' };

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayName = (iso: string) => WEEKDAY[new Date(`${iso}T12:00:00`).getDay()];
export const dayLabel = (iso: string, today: string) => {
  if (iso === today) return 'Today';
  const d = new Date(`${iso}T12:00:00`);
  const y = new Date(`${today}T12:00:00`);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
};
export const shiftDay = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const clock = (t: number) => new Date(t).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
export const fmt1 = (n: number | undefined) => (n === undefined ? '-' : Math.round(n * 10) / 10);
