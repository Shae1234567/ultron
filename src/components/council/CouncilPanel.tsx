import { useEffect, useState } from 'react';
import { ultron } from '../../services/bridge';
import { useStore } from '../../state/store';
import type { AgentId, CouncilBriefing, CouncilSeat, CouncilState } from '../../types';
import { PixelArt } from './PixelArt';
import { ORDER, TEAM, type Seat } from './pixel/palette';
import type { Scene } from './pixel/scene';

/*
 * The side panel: a character sheet for whoever has the floor, in Ultron's lettering and
 * framed in pixels like the room. Everything on it is real - the registry, Health's logs,
 * the brains - and a seat with nothing yet says so in its head's voice. A department not
 * built yet says what it will do and which build step brings it.
 */

export type View = 'overview' | Seat | 'helios' | 'briefing';

const pad = (n: number) => String(n).padStart(2, '0');
const roleOf = (name: string) => TEAM.find(([n]) => n === name)?.[1] ?? '';
let k = 0;
const st = (cls = '') => ({ className: `st ${cls}`.trim(), style: { ['--k' as string]: k++ } });

function Blocks({ nights, target }: { nights: (number | null)[]; target: number }) {
  const days = nights.map((_, i) => {
    const d = new Date(Date.now() - (nights.length - 1 - i) * 86_400_000);
    return 'SMTWTFS'[d.getDay()];
  });
  return (
    <>
      <div className="blocks">
        {nights.map((h, d) => {
          const filled = h === null ? 0 : Math.max(0, Math.min(10, Math.round((h - 5) * 2)));
          const goal = (target - 5) * 2;
          return (
            <div key={d}>
              <div className="stack">
                {Array.from({ length: 10 }, (_, j) => 10 - j).map((r) => (
                  <i key={r} className={`blk${r <= filled ? (h !== null && h >= target ? ' on' : ' low') : ''}${r === goal ? ' goal' : ''}`} style={{ ['--i' as string]: r * 2 + d }} />
                ))}
              </div>
              <span className="day">{days[d]}</span>
            </div>
          );
        })}
      </div>
      <div className="legend"><i style={{ background: 'var(--cyan)' }} />8 hours or more <i style={{ background: '#0a5a78', marginLeft: 10 }} />short. Each block is half an hour, from 5.</div>
    </>
  );
}

function Line({ seat, quiet }: { seat: CouncilSeat; quiet?: boolean }) {
  const [text, setText] = useState('');
  useEffect(() => {
    let live = true;
    setText('');
    void ultron.council.line(seat.id).then((t) => { if (live) setText(t); });
    return () => { live = false; };
  }, [seat.id, seat.metric?.value, seat.brain?.facts]);
  return (
    <div {...st(`say${quiet ? ' say--quiet' : ''}`)}>
      <span className="by">{seat.head.name}</span>
      {text || '...'}
    </div>
  );
}

/** "Clio, Asclepius and Prometheus have a seat. 2 more arrive as they are built." - or, with every seat filled, no countdown. */
export function seatedLine(heads: string[], seats: number): string {
  if (!heads.length) return 'No seats are filled yet.';
  const names = heads.length === 1 ? heads[0] : `${heads.slice(0, -1).join(', ')} and ${heads[heads.length - 1]}`;
  if (heads.length >= seats) return `Every seat is filled: ${names}. Everything they learn ends up with me.`;
  const left = seats - heads.length;
  return `${names} ${heads.length === 1 ? 'has' : 'have'} a seat. ${left} more ${left === 1 ? 'arrives' : 'arrive'} as ${left === 1 ? 'it is' : 'they are'} built. Everything they learn ends up with me.`;
}

function Overview({ state, scene, onGo }: { state: CouncilState; scene: Scene | null; onGo: (v: View) => void }) {
  const seated = state.seats.filter((s) => s.built);
  const bySeat = [...state.seats].sort((a, b) => a.seat - b.seat);
  return (
    <>
      <div {...st('who-head who-head--sm')}>
        <div className="frame"><PixelArt scene={scene} spec="ultron" w={92} h={92} label="Ultron" /></div>
        <div><div className="seatline">The council</div><div className="name">Olympus</div><div className="epithet">five seats, one brain</div></div>
      </div>
      <div {...st('say say--ultron')}>
        <span className="by">Ultron</span>
        {seatedLine(seated.map((s) => s.head.name), bySeat.length)}
      </div>
      <div {...st()}>
        <div className="sec">Seats</div>
        {bySeat.map((s) => (
          <div key={s.id} className={`row go${s.built ? '' : ' is-dim'}`} role="button" tabIndex={0} onClick={() => onGo(s.id as Seat)} onKeyDown={(e) => { if (e.key === 'Enter') onGo(s.id as Seat); }}>
            <PixelArt scene={scene} spec={`mini:${s.id}`} w={48} h={48} />
            <div><div className="nm"><span className="num">{pad(s.seat)}</span>{s.head.name}</div><div className="rl">{s.name}</div></div>
            <div className="mt">{s.built && s.metric ? <><b>{s.metric.value}</b><span>{s.metric.unit}</span></> : <span>not built yet - step {s.step}</span>}</div>
          </div>
        ))}
      </div>
      <div {...st()}>
        <div className="sec">Outside</div>
        <div className={`row go${state.helios.on ? '' : ' is-dim'}`} role="button" tabIndex={0} onClick={() => onGo('helios')} onKeyDown={(e) => { if (e.key === 'Enter') onGo('helios'); }}>
          <PixelArt scene={scene} spec="helios" w={48} h={48} />
          <div><div className="nm">Helios</div><div className="rl">feeds every seat, sits on none</div></div>
          <div className="mt"><b>{state.helios.today}</b><span>{state.helios.on ? 'new since last night' : 'paused'}</span></div>
        </div>
      </div>
      <p {...st('np-note')}>Convene, and every seated head reports in one line.</p>
    </>
  );
}

function PhoneLink({ state }: { state: CouncilState }) {
  const [code, setCode] = useState<string | null>(state.phone.pairing ?? null);
  const p = state.phone;
  return (
    <div {...st()}>
      <div className="sec">From your phone</div>
      {!p.botReady ? (
        <div className="memo">Your Discord bot isn't set up yet (Apps &gt; Discord - your own bot). Once it is, you can DM it your sleep, training and food.</div>
      ) : p.linked ? (
        <div className="memo"><small>{p.connected ? 'Connected' : 'Linked - connecting'}</small>DM your Ultron bot any time: "slept 11:30 to 7", "practice 90 min, effort 8", or a photo of a nutrition label or barcode.</div>
      ) : (
        <>
          <div className="memo">
            <small>Not linked yet</small>
            {code ? <>Send <code>link {code}</code> to your Ultron bot in a Discord DM, from your own account, in the next 15 minutes.</> : 'Link your own Discord account so only your DMs are read.'}
          </div>
          {!code && <div className="np-actions"><button className="hud-btn" onClick={() => void ultron.council.phoneLink().then((r) => setCode(r.code))}>Link my phone</button></div>}
        </>
      )}
    </div>
  );
}

function SeatView({ seat, state, scene }: { seat: CouncilSeat; state: CouncilState; scene: Scene | null }) {
  const agents = useStore((s) => s.team.agents);
  const setCouncil = useStore((s) => s.setCouncil);
  const setHealth = useStore((s) => s.setHealth);
  const setSchool = useStore((s) => s.setSchool);
  const m = seat.metric;
  const openHealth = (tab = 'today') => { setCouncil({ open: false }); setHealth({ open: true, tab }); };
  const ask = () => {
    setCouncil({ open: false });
    window.dispatchEvent(new CustomEvent('ultron:prefill', { detail: `${seat.head.name}, ` }));
  };
  return (
    <>
      <div {...st('who-head')}>
        <div className={`frame${seat.built ? ' frame--lit' : ''}`}><PixelArt scene={scene} spec={`head:${seat.id}`} w={128} h={128} label={seat.head.name} /></div>
        <div>
          <div className="seatline"><span className={`seatno${seat.built ? '' : ' seatno--dim'}`}>{pad(seat.seat)}</span>{seat.name}</div>
          <div className="name">{seat.head.name}</div>
          <div className="epithet">{seat.epithet}</div>
          <p className="greek"><i>{seat.greek.letter}</i> on the chair: <i>{seat.greek.word}</i>, {seat.greek.latin}, {seat.greek.meaning}</p>
          {!seat.built && <span className="unbuilt-plate">NOT BUILT YET - STEP {seat.step}</span>}
        </div>
      </div>
      <Line seat={seat} quiet={!seat.built} />
      {seat.built && m ? (
        <div {...st()}>
          <div className="sec">This week</div>
          <div className="readout"><b>{m.value}</b><span>{m.unit}</span></div>
          {m.nights && m.target ? <Blocks nights={m.nights} target={m.target} /> : null}
          {m.extra && <div className="legend">{m.extra}.</div>}
        </div>
      ) : (
        <div {...st()}>
          <div className="sec">Its number</div>
          <div className="legend">{seat.metricName}.</div>
        </div>
      )}
      <div {...st()}>
        <div className="sec">Specialists</div>
        {seat.specialists.map((s) => {
          const card = s.live ? agents[s.id as AgentId] : undefined;
          const working = card?.status === 'working';
          return (
            <div key={s.id} className={`row${seat.built ? '' : ' is-dim'}`}>
              <PixelArt scene={scene} spec={`face:${s.name}`} w={48} h={48} />
              <div><div className="nm">{s.name}</div><div className="rl">{s.job}</div>{working && card?.task ? <div className="doing">{card.task}</div> : null}</div>
              <div className={`stt${working ? ' on' : ''}`}>{!s.live ? `step ${seat.step}` : working ? <><span className="dot dot--live" />working</> : 'on call'}</div>
            </div>
          );
        })}
      </div>
      <div {...st()}>
        <div className="sec">Borrowed from the team</div>
        <div className="borrow">
          {seat.borrows.map((b) => (
            <figure key={b}><PixelArt scene={scene} spec={`bust:${b}`} w={32} h={50} /><figcaption><b>{b}</b><span>{roleOf(b)}</span></figcaption></figure>
          ))}
        </div>
      </div>
      {seat.built && (
        <div {...st()}>
          <div className="sec">Own brain</div>
          <div className="readout"><b>{seat.brain?.facts ?? 0}</b><span>facts kept</span></div>
          <div className="memo">
            {seat.brain?.last
              ? <><small>Last remembered: {seat.brain.last.date} - {seat.brain.last.who}</small>{seat.brain.last.text}</>
              : <><small>Nothing yet</small>It fills as you talk to {seat.name}: confirmed facts only.</>}
          </div>
        </div>
      )}
      {seat.id === 'health' && seat.built && <PhoneLink state={state} />}
      <div {...st()}>
        <div className="sec">From Helios today</div>
        {seat.built && state.helios.intel[seat.id as keyof typeof state.helios.intel] ? (
          <ul className="hlog">{state.helios.intel[seat.id as keyof typeof state.helios.intel]!.split('\n').map((l) => <li key={l}>{l.replace(/^- /, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}</li>)}</ul>
        ) : (
          <div className="legend">{seat.built ? `Nothing written up for ${seat.name} yet today - next sweep at ${clock(state.helios.nextSweep)}.` : `Helios feeds ${seat.name} once it is built (step ${seat.step}).`}</div>
        )}
      </div>
      {seat.built && (
        <div {...st('np-actions')}>
          {seat.id === 'health' && <button className="hud-btn hud-btn--active" onClick={() => openHealth()}>Open Health</button>}
          {seat.id === 'school' && <button className="hud-btn hud-btn--active" onClick={() => { setCouncil({ open: false }); setSchool({ open: true, tab: 'week' }); }}>Open School</button>}
          <button className={`hud-btn${seat.id === 'health' || seat.id === 'school' ? '' : ' hud-btn--active'}`} onClick={ask}>Ask {seat.head.name}</button>
          <button className="hud-btn" onClick={() => void ultron.vault.open('Brains')}>Open its notes</button>
        </div>
      )}
    </>
  );
}

const clock = (t: number) => new Date(t).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Helios' 40-call day as 40 pixel segments - spent ones lit. */
function Budget({ used, cap }: { used: number; cap: number }) {
  return (
    <div className="budget" role="meter" aria-label={`${used} of ${cap} AI calls used today`} aria-valuenow={used} aria-valuemin={0} aria-valuemax={cap}>
      {Array.from({ length: cap }, (_, i) => <i key={i} className={i < used ? 'on' : ''} />)}
    </div>
  );
}

function HeliosView({ state, scene }: { state: CouncilState; scene: Scene | null }) {
  const h = state.helios;
  const [on, setOn] = useState(h.on);
  const toggle = async () => setOn((await ultron.council.helios(!on)).on);
  const seats = state.seats.filter((s) => s.built);
  return (
    <>
      <div {...st('who-head')}>
        <div className="frame frame--lit"><PixelArt scene={scene} spec="helios" w={128} h={128} label="Helios" /></div>
        <div>
          <div className="seatline">Outside the chamber</div>
          <div className="name">Helios</div>
          <div className="epithet">the sun that sees everything</div>
          <p className="greek"><i>Ἥλιος</i>, hēlios, the sun itself. Helium was named after him: it was found in sunlight before anyone found it on Earth.</p>
        </div>
      </div>
      <div {...st(`say${on ? '' : ' say--quiet'}`)}>
        <span className="by">Helios</span>
        {!on ? 'Paused. Nothing is pulled or written until you start me again.'
          : h.today ? `${h.today} thing${h.today === 1 ? '' : 's'} worth a look since last night, across ${seats.map((s) => s.name).join(' and ')}. Next sweep at ${clock(h.nextSweep)}.`
            : `Watching for ${seats.map((s) => s.name).join(' and ')}. Next sweep at ${clock(h.nextSweep)}.`}
      </div>
      <div {...st()}>
        <div className="sec">AI today</div>
        <div className="readout"><b>{h.budget.used}/{h.budget.cap}</b><span>calls - cloud only, never your GPU</span></div>
        <Budget used={h.budget.used} cap={h.budget.cap} />
        <div className="legend">Free pulls every hour while Ultron is idle; sweeps at 7:00, 15:30 and 20:00.{h.lastPull ? ` Last pull ${clock(h.lastPull)}.` : ''}</div>
      </div>
      <div {...st()}>
        <div className="sec">Standing requests</div>
        {h.requests.length ? h.requests.map((r) => (
          <div key={r.id} className="row">
            <PixelArt scene={scene} spec={`mini:${r.dept}`} w={48} h={48} />
            <div><div className="nm">{r.what}</div><div className="rl">for {r.dept}, asked by {r.by}</div></div>
            <div className="stt">every sweep</div>
          </div>
        )) : <div className="legend">None yet. Ask any head: "have Helios watch Calgary Cavalry fixtures".</div>}
      </div>
      <div {...st()}>
        <div className="sec">Today's log</div>
        {h.log.length ? (
          <ul className="hlog">{[...h.log].reverse().slice(0, 12).map((l, i) => <li key={i}><b>{clock(l.at)}</b>{l.text}</li>)}</ul>
        ) : <div className="legend">Nothing yet today - the first pull comes a few minutes after Ultron starts.</div>}
      </div>
      <div {...st('np-actions')}>
        <button className="hud-btn hud-btn--active" onClick={() => void ultron.vault.open(`Intel/${new Date().toISOString().slice(0, 10)}.md`)}>Read today's intel</button>
        <button className="hud-btn" onClick={() => void toggle()}>{on ? 'Pause Helios' : 'Start Helios'}</button>
      </div>
    </>
  );
}

function Briefing({ briefing, scene }: { briefing: CouncilBriefing | 'loading'; scene: Scene | null }) {
  if (briefing === 'loading') return <div className="st"><div className="seatline">Convening</div><div className="name">One line each</div></div>;
  const at = new Date(briefing.at).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <>
      <div className="st"><div className="seatline">Convened at {at}</div><div className="name">One line each</div></div>
      {briefing.lines.map((l, n) => (
        <div key={l.id} className="bf st" style={{ animationDelay: `${480 + n * 160}ms` }}>
          <PixelArt scene={scene} spec={`mini:${l.id}`} w={48} h={48} />
          <div className={`say say--sm${l.built ? '' : ' say--quiet'}`}><span className="by">{l.head}</span>{l.text}</div>
        </div>
      ))}
      <div className="bf st" style={{ animationDelay: `${480 + briefing.lines.length * 160 + 140}ms` }}>
        <PixelArt scene={scene} spec="ultron" w={48} h={48} />
        <div className="say say--sm say--ultron"><span className="by">Ultron</span>{briefing.summary}</div>
      </div>
    </>
  );
}

export function CouncilPanel({ view, state, scene, briefing, onGo }: {
  view: View; state: CouncilState; scene: Scene | null; briefing: CouncilBriefing | 'loading' | null; onGo: (v: View) => void;
}) {
  k = 0;
  const seat = (ORDER as readonly string[]).includes(view) ? state.seats.find((s) => s.id === view) : undefined;
  return (
    <aside className="council-panel" aria-live="polite">
      {view === 'briefing' && briefing ? <Briefing briefing={briefing} scene={scene} />
        : view === 'helios' ? <HeliosView state={state} scene={scene} />
          : seat ? <SeatView key={seat.id} seat={seat} state={state} scene={scene} />
            : <Overview state={state} scene={scene} onGo={onGo} />}
    </aside>
  );
}
