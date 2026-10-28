import { useEffect, useMemo, useRef, useState } from 'react';
import { ultron } from '../../services/bridge';
import type { FoodEntry, FoodItem, Meal, Nutrients, TableMatch } from '../../types';
import { useHealth } from './context';
import { Chips, Empty, Sec, Segments, dayName } from './ui';

/*
 * Demeter's page - fuel, not diet: no calories, no "good" or "bad" food. Type what you ate the
 * way you'd say it and see what it gives you as you type; one tap for a saved usual meal; a
 * barcode for exact numbers. Then the day (or the week) against what a 14-18-year-old athlete
 * needs, the foods to ask a parent for, and water.
 */

const MEALS: { id: Meal; text: string }[] = [
  { id: 'breakfast', text: 'Breakfast' }, { id: 'lunch', text: 'Lunch' }, { id: 'dinner', text: 'Dinner' },
  { id: 'snack', text: 'Snack' }, { id: 'pre-training', text: 'Pre-training' }, { id: 'post-training', text: 'Post-training' },
];
const NUTRIENTS: { key: keyof Nutrients & keyof typeof SHORT; unit: string }[] = [
  { key: 'protein_g', unit: 'g' }, { key: 'iron_mg', unit: 'mg' }, { key: 'calcium_mg', unit: 'mg' },
  { key: 'vitd_ug', unit: 'ug' }, { key: 'fibre_g', unit: 'g' }, { key: 'fruitveg', unit: '' },
];
const SHORT = { protein_g: 'Protein', iron_mg: 'Iron', calcium_mg: 'Calcium', vitd_ug: 'Vitamin D', fibre_g: 'Fibre', fruitveg: 'Fruit & veg' } as const;
const WHY: Record<keyof typeof SHORT, string> = {
  protein_g: 'repairs muscle after training',
  iron_mg: 'carries oxygen to your muscles',
  calcium_mg: 'builds bone - your teens are when it counts most',
  vitd_ug: 'helps calcium land; almost no sun for it in Calgary from October to March',
  fibre_g: 'steady energy',
  fruitveg: 'vitamins for recovery',
};

function mealNow(): Meal {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 10.5) return 'breakfast';
  if (h < 14.5) return 'lunch';
  if (h < 17) return 'snack';
  if (h < 21) return 'dinner';
  return 'snack';
}
const r1 = (n: number | undefined) => (n === undefined ? 0 : Math.round(n * 10) / 10);

function ItemChip({ it, onRemove }: { it: FoodItem; onRemove?: () => void }) {
  return (
    <span className={`hl-food${it.exact ? ' is-exact' : ''}`} title={NUTRIENTS.map((n) => `${SHORT[n.key]} ${r1(it.nutrients[n.key])}${n.unit}`).join(', ')}>
      <b>{it.name}</b> <span>{it.amount}</span> <em>{r1(it.nutrients.protein_g)} g protein</em>
      {it.exact && <i>exact</i>}
      {onRemove && <button aria-label={`Remove ${it.name}`} onClick={onRemove}>x</button>}
    </span>
  );
}

export function FoodPage() {
  const h = useHealth();
  const { v } = h;
  const editing = h.editing?.kind === 'food' ? h.editing.entry : null;
  const [meal, setMeal] = useState<Meal>(editing?.meal ?? mealNow());
  const [text, setText] = useState('');
  const [exact, setExact] = useState<FoodItem[]>([]);
  const [preview, setPreview] = useState<{ items: FoodItem[]; unknown: string[] }>({ items: [], unknown: [] });
  const [hits, setHits] = useState<TableMatch[]>([]);
  const [code, setCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [usualName, setUsualName] = useState('');
  const [scope, setScope] = useState<'day' | 'week'>('day');
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    setMeal(editing.meal ?? mealNow());
    const ex = editing.items.filter((i) => i.exact);
    setExact(ex);
    setText(ex.length === editing.items.length && !editing.unknown.length ? '' : editing.text);
  }, [editing?.id]);

  // What the words give, as he types - and table foods matching the last thing typed.
  useEffect(() => {
    const t = setTimeout(() => {
      void ultron.health.preview(text).then(setPreview);
      const last = text.split(/,|;|\band\b|\bwith\b/i).pop()?.trim() ?? '';
      if (last.length >= 2) void ultron.health.search(last.replace(/^\d+(\.\d+)?\s*(x\s*)?/i, '')).then(setHits);
      else setHits([]);
    }, 160);
    return () => clearTimeout(t);
  }, [text]);

  const pick = (m: TableMatch) => {
    const parts = text.split(',');
    const lastRaw = parts.pop() ?? '';
    const qty = /^\s*(\d+(?:\.\d+)?|a|an|one|two|three|half)\s+/i.exec(lastRaw)?.[0] ?? '';
    setText([...parts, `${parts.length ? ' ' : ''}${qty.trim() ? `${qty.trim()} ` : ''}${m.name}`].join(',') + ', ');
    setHits([]);
    box.current?.focus();
  };

  const lookup = async () => {
    setCodeBusy(true);
    const r = await ultron.health.barcode(code);
    setCodeBusy(false);
    if ('error' in r) { h.toast(r.error, true); return; }
    setExact((xs) => [...xs, r]);
    setCode('');
  };

  const clear = () => { setText(''); setExact([]); setPreview({ items: [], unknown: [] }); };
  const save = async () => {
    const p = { text: text.replace(/[,\s]+$/, ''), exact, meal };
    const r = editing ? await h.edit('food', editing.id, { ...p, date: editing.date }, 'Updated.') : await h.log('food', p, 'Logged.');
    if (r.ok) clear();
  };
  const saveUsual = async () => {
    const r = await ultron.health.saveUsual(usualName, { text: text.replace(/[,\s]+$/, ''), exact });
    if (!r.ok) h.toast(r.error, true);
    else { h.toast(`Saved "${usualName}". Next time it's one tap.${r.detail ? ` ${r.detail}` : ''}`); setUsualName(''); }
  };

  const items = [...preview.items, ...exact];
  const sum = (k: keyof Nutrients) => items.reduce((n, i) => n + (i.nutrients[k] ?? 0), 0);
  const canSave = items.length > 0 || preview.unknown.length > 0;

  const totals: Record<string, number | undefined> = scope === 'day' ? { ...v.food.totals } : v.food.week?.perDay ?? {};
  const byMeal = useMemo(() => {
    const groups = new Map<string, FoodEntry[]>();
    for (const f of v.food.day) { const k = f.meal ?? 'food'; groups.set(k, [...(groups.get(k) ?? []), f]); }
    return [...groups.entries()];
  }, [v.food.day]);

  return (
    <div className="hl-page">
      <div className="hl-cols">
        <section className="hl-form">
          <Sec>{editing ? 'Edit what you ate' : 'What did you eat?'}</Sec>
          <Chips label="Meal" options={MEALS} value={meal} onChange={setMeal} />
          <div className="hl-suggest">
            <input ref={box} className="hud-input hl-foodbox" placeholder="e.g. 2 eggs, toast, glass of milk" value={text}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && canSave) void save(); }} aria-label="What you ate" autoFocus />
            {hits.length > 0 && (
              <div className="hl-suggest__list" role="listbox" aria-label="Foods">
                {hits.map((m) => (
                  <button key={m.name} role="option" aria-selected={false} onClick={() => pick(m)}>
                    <b>{m.name}</b> <span>{m.serving}</span> <em>{r1(m.nutrients.protein_g)} g protein</em>
                  </button>
                ))}
              </div>
            )}
          </div>
          {(items.length > 0 || preview.unknown.length > 0) && (
            <div className="hl-foods" aria-live="polite">
              {preview.items.map((it, i) => <ItemChip key={`p${i}`} it={it} />)}
              {exact.map((it, i) => <ItemChip key={`x${i}`} it={it} onRemove={() => setExact((xs) => xs.filter((_, j) => j !== i))} />)}
              {preview.unknown.map((u) => <span key={u} className="hl-food is-unknown"><b>{u}</b> <span>not in the food table</span></span>)}
            </div>
          )}
          {items.length > 0 && (
            <div className="hl-mealsum">
              {NUTRIENTS.map((n) => <span key={n.key}><b>{r1(sum(n.key))}</b>{n.unit} {SHORT[n.key].toLowerCase()}</span>)}
            </div>
          )}
          <div className="hl-row">
            <button className="hud-btn hud-btn--active" disabled={!canSave} onClick={() => void save()}>{editing ? 'Update' : 'Log it'}</button>
            {(text || exact.length > 0) && <button className="hud-btn" onClick={clear}>Clear</button>}
            {editing && <button className="hud-btn" onClick={() => { h.setEditing(null); clear(); }}>Cancel</button>}
          </div>
          <div className="hl-row hl-row--tight">
            <input className="hud-input hl-short" inputMode="numeric" placeholder="barcode digits" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length >= 8) void lookup(); }} aria-label="Barcode number" />
            <button className="hud-btn" disabled={code.length < 8 || codeBusy} onClick={() => void lookup()}>{codeBusy ? 'Looking...' : 'Look up (exact)'}</button>
          </div>
          {items.length > 0 && !editing && (
            <div className="hl-row hl-row--tight">
              <input className="hud-input hl-short" placeholder='save as, e.g. "usual breakfast"' value={usualName} onChange={(e) => setUsualName(e.target.value)} aria-label="Usual meal name" />
              <button className="hud-btn" disabled={!usualName.trim()} onClick={() => void saveUsual()}>Save as usual</button>
            </div>
          )}
          <div className="hl-dim">Words are estimated from a food table - good for patterns across a week. Barcodes are exact (only the number is sent to Open Food Facts).</div>
        </section>

        <section className="hl-form">
          <Sec>One tap</Sec>
          {v.food.usual.length > 0 ? (
            <div className="hl-quick">
              {v.food.usual.map((u) => (
                <span key={u.name} className="hl-quick__u">
                  <button className="hl-chip is-on" onClick={() => void h.log('food', { usual: u.name, meal }, `${u.name} logged.`)} title={u.items.map((i) => `${i.name} (${i.amount})`).join(', ')}>{u.name}</button>
                  <button className="hl-mini" aria-label={`Forget ${u.name}`} onClick={() => void ultron.health.removeUsual(u.name)}>x</button>
                </span>
              ))}
            </div>
          ) : <div className="hl-dim">Type a meal you eat a lot, then "Save as usual" - after that it's one tap.</div>}
          {v.food.recent.length > 0 && (
            <>
              <div className="hl-label">Recent</div>
              <div className="hl-quick">
                {v.food.recent.map((r) => <button key={r.text} className="hl-chip" onClick={() => { setText(r.text); if (r.meal) setMeal(r.meal); box.current?.focus(); }}>{r.text}</button>)}
              </div>
            </>
          )}
          <Sec>Water</Sec>
          <div className="hl-water">
            <div className="hl-big">{(v.water.ml / 1000).toFixed(2).replace(/0$/, '')}<small>of {(v.water.target / 1000).toFixed(1)} L</small></div>
            <Segments share={v.water.ml / v.water.target} label="Water today" tone={v.water.ml >= v.water.target * 0.8 ? 'ok' : 'low'} />
            <div className="hl-row">
              <button className="hl-mini" onClick={() => void h.log('water', { ml: 250 })}>+ glass 250</button>
              <button className="hl-mini" onClick={() => void h.log('water', { ml: 500 })}>+ bottle 500</button>
              <button className="hl-mini" onClick={() => void h.log('water', { ml: 750 })}>+ big bottle 750</button>
              {v.water.ml > 0 && <button className="hl-mini" onClick={() => void h.log('water', { ml: -250 })}>- 250</button>}
            </div>
            <div className="hl-waterweek">
              {v.water.days.map((d) => (
                <div key={d.date} title={`${d.date}: ${d.ml} ml`}><i style={{ height: `${Math.min(100, (d.ml / v.water.target) * 100)}%` }} /><span>{dayName(d.date).slice(0, 2)}</span></div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="hl-cols">
        <section>
          <Sec right={<Chips label="Show" options={[{ id: 'day', text: 'This day' }, { id: 'week', text: 'Week average' }]} value={scope} onChange={setScope} />}>What it gives you</Sec>
          {scope === 'week' && !v.food.week ? <Empty>No food logged this week yet.</Empty> : (
            <div className="hl-targets">
              {NUTRIENTS.map((n) => {
                const have = totals[n.key] ?? 0;
                const target = v.targets[n.key];
                const share = have / target;
                return (
                  <div key={n.key} className="hl-target">
                    <div className="hl-target__h"><b>{SHORT[n.key]}</b><span>{r1(have)} / {target}{n.unit ? ` ${n.unit}` : ' servings'}</span></div>
                    <Segments share={share} label={`${SHORT[n.key]} against the daily target`} tone={share >= 0.8 ? 'ok' : 'low'} />
                    <div className="hl-target__w">{WHY[n.key]}</div>
                  </div>
                );
              })}
            </div>
          )}
          {v.food.askFor.length > 0 && (
            <div className="hl-ask">
              <div className="hl-label">This week is short on {v.food.askFor.map((a) => a.label.replace(/ \(.*\)/, '')).join(', ')} - foods to ask for</div>
              <ul>{v.food.askFor.map((a) => <li key={a.label}><b>{a.label.replace(/ \(.*\)/, '')}:</b> {a.foods.join(', ')}</li>)}</ul>
            </div>
          )}
          <div className="hl-by">Demeter - targets for boys 14-18 (Health Canada's reference intakes)</div>
        </section>

        <section>
          <Sec>Logged {h.date === h.today ? 'today' : 'that day'}</Sec>
          {byMeal.length ? byMeal.map(([m, fs]) => (
            <div key={m} className="hl-meal">
              <div className="hl-label">{MEALS.find((x) => x.id === m)?.text ?? 'Food'}</div>
              {fs.map((f) => (
                <div key={f.id} className="hl-meal__e">
                  <div className="hl-foods">{f.items.map((it, i) => <ItemChip key={i} it={it} />)}{f.unknown.map((u) => <span key={u} className="hl-food is-unknown"><b>{u}</b></span>)}</div>
                  <div className="hl-row hl-row--tight">
                    <button className="hl-mini" onClick={() => h.go('food', { kind: 'food', entry: f })}>Edit</button>
                    <button className="hl-mini" onClick={() => void h.remove('food', f, f.text)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )) : <Empty>Nothing logged yet.</Empty>}
          <Sec>Fuel for a {v.dayType.type === 'match' ? 'game' : v.dayType.type} day</Sec>
          <ul className="hl-tips">{v.fuelTips.map((t) => <li key={t}>{t}</li>)}</ul>
          {v.program ? (
            <>
              <Sec>Eat to grow - {v.program.name}</Sec>
              <ul className="hl-tips">{v.program.growFood.map((t) => <li key={t}>{t}</li>)}</ul>
            </>
          ) : null}
          <button className="link-btn" onClick={() => h.ask('Demeter, what should I eat today? ')}>Ask Demeter</button>
        </section>
      </div>
    </div>
  );
}
