/**
 * The planner's regression scenarios, run against the port.
 *
 * These are the same four days and the same assertions used against CM8 itself,
 * including the one that produced the original bug report: a day blocked out
 * with meals by hand, which used to list lunch twice and silently drop the
 * training session.
 *
 *   node tools/planner-check.mjs
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(os.tmpdir(), 'cm8-planner-' + Date.now() + '.mjs');
await esbuild.build({
  entryPoints: [path.join(HERE, '..', 'src', 'cm8', 'planner.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
});
const P = await import(pathToFileURL(outfile).href);

const results = [];
const check = (name, cond, detail) => results.push({ name, ok: !!cond, detail });

const hhmm = (h, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const block = (label, sh, sm, eh, em) => ({ label, start: sh * 60 + sm, end: eh * 60 + em });

const titles = (plan) => plan.events.map((e) => e.title);
const times = (plan, title) => plan.events.filter((e) => e.title === title).map((e) => e.start);

/* ── Scenario 1: the reported day - meals blocked by hand, no room to train ── */
let plan = P.buildPlan({
  sleptAt: hhmm(23, 45), wokeAt: hhmm(9), wakeTarget: hhmm(9),
  training: 'full', homework: 0, notes: '',
  busy: [
    block('Breakfast', 9, 30, 10, 30),
    block('Gaming', 11, 0, 14, 0),
    block('Lunch', 15, 0, 17, 30),
    block('Dinner', 19, 0, 20, 0),
  ],
});
check('lunch appears exactly once', titles(plan).filter((t) => t === 'Lunch').length === 1, titles(plan).join(' | '));
check('breakfast appears exactly once', titles(plan).filter((t) => t === 'Breakfast').length === 1, titles(plan).join(' | '));
check('dinner appears exactly once', titles(plan).filter((t) => t === 'Dinner').length === 1, titles(plan).join(' | '));
check('his own gaming block survives', titles(plan).includes('Gaming'));
check('warns that training would not fit', !!plan.trainWarning, String(plan.trainWarning));
check('no training event was placed', !titles(plan).includes('Training session'));
check('fuel advice moved onto his own lunch block',
  plan.events.some((e) => e.title === 'Lunch' && /real protein/.test(e.note)));
check('his lunch keeps its own 3pm slot', times(plan, 'Lunch')[0] === 15 * 60, String(times(plan, 'Lunch')));
check('only the two non-meal blocks stay generic',
  plan.events.filter((e) => /Locked block/.test(e.note)).length === 2,
  String(plan.events.filter((e) => /Locked block/.test(e.note)).map((e) => e.title)));

/* ── Scenario 2: a normal school day ── */
plan = P.buildPlan({
  sleptAt: hhmm(23, 45), wokeAt: hhmm(9), wakeTarget: hhmm(9),
  training: 'full', homework: 60, notes: '',
  busy: [block('School', 8, 30, 15, 30), block('Rangers practice', 18, 0, 19, 30)],
});
check('normal day schedules lunch once', titles(plan).filter((t) => t === 'Lunch').length === 1);
check('normal day schedules breakfast once', titles(plan).filter((t) => t === 'Breakfast').length === 1);
check('normal day schedules dinner once', titles(plan).filter((t) => t === 'Dinner').length === 1);
check('practice block is recognised as the session', titles(plan).includes('Rangers practice'));
check('no duplicate training event alongside practice', !titles(plan).includes('Training session'));
check('no false training warning', !plan.trainWarning, String(plan.trainWarning));
check('recovery snack placed after the session', titles(plan).includes('Recovery snack'));
check('homework was placed', titles(plan).some((t) => t.startsWith('Homework block')));

/* ── Scenario 3: room to train ── */
plan = P.buildPlan({
  sleptAt: hhmm(23, 30), wokeAt: hhmm(8), wakeTarget: hhmm(7),
  training: 'full', homework: 0, notes: '',
  busy: [block('School', 8, 30, 15, 30)],
});
check('training session placed when there is room', titles(plan).includes('Training session'));
check('no warning when the session fits', !plan.trainWarning);

/* ── Scenario 4: rest day ── */
plan = P.buildPlan({
  sleptAt: hhmm(23, 30), wokeAt: hhmm(8), wakeTarget: hhmm(7),
  training: 'rest', homework: 0, notes: '',
  busy: [block('School', 8, 30, 15, 30)],
});
check('rest day schedules no session', !titles(plan).includes('Training session'));
check('rest day does not warn about training', !plan.trainWarning);

/* ── ordering and sleep maths ── */
plan = P.buildPlan({
  sleptAt: hhmm(23, 0), wokeAt: hhmm(7), wakeTarget: hhmm(7),
  training: 'light', homework: 90, notes: 'hamstrings are tight and I have a math test',
  busy: [block('School', 8, 30, 15, 30)],
});
const keyed = plan.events.map((e) => (e.start < plan.wokeAt ? e.start + 1440 : e.start));
check('events are ordered from wake-up', keyed.every((v, i, a) => i === 0 || a[i - 1] <= v), String(keyed));
check('lights out is last', plan.events[plan.events.length - 1].title === 'Lights out');
check('nine and a quarter hours of sleep targeted', plan.totalNeed === 555, String(plan.totalNeed));
check('bedtime is 9h15 before the alarm',
  ((plan.wakeTarget + 1440 - plan.bedtime) % 1440) === 555,
  `${plan.bedtime} -> ${plan.wakeTarget}`);
check('notes advice picks the soreness line', /stop sign/.test(plan.noteAdvice), plan.noteAdvice);

fs.unlinkSync(outfile);

const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log('FAIL ' + r.name + (r.detail ? '  <<< ' + r.detail : ''));
console.log(`planner: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
