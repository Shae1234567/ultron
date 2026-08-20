/**
 * Extracts every piece of static content out of the CM8 coach app and emits it
 * as a typed module for Atlas (src/cm8/content.ts).
 *
 * Why extract instead of retype: CM8 holds 14 day-cards, 60+ drills, 32 library
 * exercises, 5 pillars, the tryout guidance, the fuel plates, the tier pathway
 * and a ~30-topic coach knowledge base. Copying that by hand loses fidelity and
 * silently drifts the moment CM8 changes. Re-run this after any CM8 content
 * change and the port stays in step.
 *
 *   node tools/extract-cm8.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.CM8_SRC || 'C:/Users/shaeg/Downloads/index_8.html';
const OUT = path.join(HERE, '..', 'src', 'cm8', 'content.ts');

const html = fs.readFileSync(SRC, 'utf8');

/* ---------- helpers ---------- */
const ENT = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&mdash;': '\u2014', '&ndash;': '\u2013', '&middot;': '\u00b7',
  '&nbsp;': ' ', '&times;': '\u00d7', '&#8594;': '\u2192', '&hellip;': '\u2026',
};
const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (m) => (ENT[m] === undefined ? m : ENT[m]))
  .replace(/\s+/g, ' ')
  .trim();

const strip = (s) => decode(s.replace(/<[^>]*>/g, ' '));

/** Slice a <section id="x"> ... </section> block. */
function section(id) {
  const start = html.indexOf('<section id="' + id + '"');
  if (start < 0) throw new Error('section ' + id + ' not found');
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}

/** Balanced-bracket lift of a JS array literal declared as `const NAME = [`. */
function jsLiteral(name) {
  const decl = new RegExp('const\\s+' + name + '\\s*=\\s*\\[');
  const m = decl.exec(html);
  if (!m) throw new Error('literal ' + name + ' not found');
  let i = m.index + m[0].length - 1;
  let depth = 0;
  let inStr = null;
  let prev = '';
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c;
    } else if (c === '[' || c === '{') {
      depth++;
    } else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) break;
    }
    prev = c;
  }
  return html.slice(m.index + m[0].length - 1, i + 1);
}

const first = (re, scope) => {
  const m = re.exec(scope);
  return m ? m[1] : '';
};
const all = (re, scope) => [...scope.matchAll(re)].map((m) => m[1]);

/* ---------- day cards (in-season + off-season) ---------- */
function dayCards(scope) {
  return scope.split('<div class="day-card">').slice(1).map((card) => {
    const names = all(/<span class="da-name">([\s\S]*?)<\/span>/g, card).map(strip);
    const details = all(/<div class="da-panel-inner"><p>([\s\S]*?)<\/p>/g, card).map(strip);
    const intensityBlock = first(/<div class="intensity">([\s\S]*?)<\/div>\s*<div/, card);
    return {
      day: strip(first(/<div class="dname">([\s\S]*?)<\/div>/, card)),
      focus: strip(first(/<div class="dfocus[^"]*"[^>]*>([\s\S]*?)<\/div>/, card)),
      cue: strip(first(/<div class="dcue">([\s\S]*?)<\/div>/, card)).replace(/^"|"$/g, ''),
      intensity: (intensityBlock.match(/class="on"/g) || []).length,
      duration: strip(first(/<div class="dur">([\s\S]*?)<\/div>/, card)),
      drills: names.map((name, i) => ({ name, detail: details[i] || '' })),
    };
  });
}

/* ---------- exercise cards ---------- */
function exCards(scope) {
  return [...scope.matchAll(
    /<div class="ex-card"><div class="en">([\s\S]*?)<\/div><span class="er">([\s\S]*?)<\/span><p>([\s\S]*?)<\/p><\/div>/g,
  )].map((m) => ({ name: strip(m[1]), dose: strip(m[2]), note: strip(m[3]) }));
}

/* ---------- home workout library ---------- */
function library() {
  const off = section('offseason');
  const tabs = [...off.matchAll(
    /<button class="lib-tab[^"]*" onclick="switchLib\('([a-z]+)'\)">([\s\S]*?)<\/button>/g,
  )].map((m) => ({ key: m[1], label: strip(m[2]) }));

  return tabs.map(({ key, label }, idx) => {
    const start = off.indexOf('id="lib-' + key + '"');
    const nextKey = tabs[idx + 1];
    const end = nextKey ? off.indexOf('id="lib-' + nextKey.key + '"', start + 1) : off.length;
    const scope = off.slice(start, end > 0 ? end : off.length);
    return {
      key,
      label,
      note: strip(first(/<div class="sec-note"[^>]*>([\s\S]*?)<\/div>/, scope)),
      items: exCards(scope),
    };
  });
}

/* ---------- CM lab pillars ---------- */
function pillars() {
  const lab = section('lab');
  // The section wrapper also starts with "pillar", so require a real pnum.
  return lab.split('<div class="pillar').slice(1).filter((p) => /class="pnum"/.test(p)).map((p) => ({
    num: strip(first(/<div class="pnum">([\s\S]*?)<\/div>/, p)),
    title: strip(first(/<h3[^>]*>([\s\S]*?)<\/h3>/, p)),
    cue: strip(first(/<div class="cue">([\s\S]*?)<\/div>/, p)),
    why: strip(first(/<div class="why">([\s\S]*?)<\/div>/, p)),
    drills: all(/<div class="drill">([\s\S]*?)<\/div>/g, p).map(strip),
  }));
}

/* ---------- tryouts ---------- */
function tryouts() {
  const t = section('tryouts');
  return {
    cards: t.split('<div class="tryout-card">').slice(1).map((c) => ({
      title: strip(first(/<h3[^>]*>([\s\S]*?)<\/h3>/, c)),
      body: strip(first(/<p[^>]*>([\s\S]*?)<\/p>/, c)),
    })),
    looksFor: all(/<div class="cmini">([\s\S]*?)<\/div>/g, t).map(strip),
  };
}

/* ---------- fuel ---------- */
function fuel() {
  const f = section('fuel');
  return {
    plates: f.split('<div class="plate"').slice(1).map((p) => ({
      title: strip(first(/<h4[^>]*>([\s\S]*?)<\/h4>/, p)),
      body: strip(first(/<p[^>]*>([\s\S]*?)<\/p>/, p)),
    })),
    timeline: f.split('<div class="tline-row">').slice(1).map((r) => ({
      when: strip(first(/<div class="when">([\s\S]*?)<\/div>/, r)),
      what: strip(first(/<div class="what">([\s\S]*?)<\/div>/, r)),
    })),
  };
}

/* ---------- pathway ---------- */
function pathway() {
  const p = section('pathway');
  return {
    stops: p.split('<div class="tier-stop').slice(1).map((s) => ({
      label: strip(first(/<div class="tier-dot">([\s\S]*?)<\/div>/, s)),
      title: strip(first(/<h4[^>]*>([\s\S]*?)<\/h4>/, s)),
      body: strip(first(/<p[^>]*>([\s\S]*?)<\/p>/, s)),
      state: /^ current/.test(s.slice(0, 12)) ? 'current'
        : /^ target/.test(s.slice(0, 12)) ? 'target' : 'future',
    })),
    phases: p.split('<div class="climb-phase">').slice(1).map((c) => ({
      title: strip(first(/<h4[^>]*>([\s\S]*?)<\/h4>/, c)),
      items: all(/<div class="check-item">([\s\S]*?)<\/div>/g, c).map(strip),
    })),
  };
}

/* ---------- emit ---------- */
const data = {
  week: dayCards(section('week')),
  offseason: dayCards(section('offseason')),
  library: library(),
  pillars: pillars(),
  tryouts: tryouts(),
  fuel: fuel(),
  pathway: pathway(),
};

const banner = '/* AUTO-GENERATED by tools/extract-cm8.mjs - do not edit by hand.\n'
  + ' * Source: the CM8 coach app (index_8.html). Re-run the extractor after any\n'
  + ' * CM8 content change and this file stays in step. */\n\n';

const types = [
  'export interface Drill { name: string; detail: string }',
  'export interface DayCard { day: string; focus: string; cue: string; intensity: number; duration: string; drills: Drill[] }',
  'export interface ExCard { name: string; dose: string; note: string }',
  'export interface LibraryTab { key: string; label: string; note: string; items: ExCard[] }',
  'export interface Pillar { num: string; title: string; cue: string; why: string; drills: string[] }',
  'export interface Titled { title: string; body: string }',
  'export interface TierStop { label: string; title: string; body: string; state: string }',
  'export interface ClimbPhase { title: string; items: string[] }',
  'export interface Zone { y: number; title: string; body: string }',
  '',
].join('\n') + '\n';

const j = (v) => JSON.stringify(v, null, 2);

const out = banner + types
  + 'export const WEEK: DayCard[] = ' + j(data.week) + ';\n\n'
  + 'export const OFFSEASON: DayCard[] = ' + j(data.offseason) + ';\n\n'
  + 'export const LIBRARY: LibraryTab[] = ' + j(data.library) + ';\n\n'
  + 'export const PILLARS: Pillar[] = ' + j(data.pillars) + ';\n\n'
  + 'export const TRYOUT_CARDS: Titled[] = ' + j(data.tryouts.cards) + ';\n\n'
  + 'export const TRYOUT_LOOKS_FOR: string[] = ' + j(data.tryouts.looksFor) + ';\n\n'
  + 'export const FUEL_PLATES: Titled[] = ' + j(data.fuel.plates) + ';\n\n'
  + 'export const FUEL_TIMELINE: { when: string; what: string }[] = ' + j(data.fuel.timeline) + ';\n\n'
  + 'export const TIER_STOPS: TierStop[] = ' + j(data.pathway.stops) + ';\n\n'
  + 'export const CLIMB_PHASES: ClimbPhase[] = ' + j(data.pathway.phases) + ';\n\n'
  + '/* Lifted verbatim from CM8 so the pitch map and the coach answers stay identical. */\n'
  + 'export const ZONES: Zone[] = ' + jsLiteral('ZONES') + ';\n\n'
  + 'export const COACH_KB = ' + jsLiteral('KB') + ' as const;\n';

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, 'utf8');

const drills = data.week.concat(data.offseason).reduce((s, d) => s + d.drills.length, 0);
console.log('extracted -> src/cm8/content.ts');
console.log('  week days      ' + data.week.length);
console.log('  offseason days ' + data.offseason.length);
console.log('  library tabs   ' + data.library.length + ' (' + data.library.map((t) => t.key + ':' + t.items.length).join(', ') + ')');
console.log('  pillars        ' + data.pillars.length);
console.log('  tryout cards   ' + data.tryouts.cards.length + ' + ' + data.tryouts.looksFor.length + ' looks-for');
console.log('  fuel           ' + data.fuel.plates.length + ' plates, ' + data.fuel.timeline.length + ' timeline rows');
console.log('  pathway        ' + data.pathway.stops.length + ' stops, ' + data.pathway.phases.length + ' phases');
console.log('  drills total   ' + drills);
