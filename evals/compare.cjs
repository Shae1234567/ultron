#!/usr/bin/env node
// Compares two eval result files task by task:  node evals/compare.cjs evals/results/v1.json evals/results/v2.json
// Both are re-scored from their saved answers with the CURRENT tasks.json and score.cjs, so a scoring fix
// applies to every run equally.
const fs = require('node:fs');
const path = require('node:path');
const { score } = require('./score.cjs');

const [aFile, bFile, taskArg] = process.argv.slice(2);
if (!aFile || !bFile) {
  console.error('usage: node evals/compare.cjs <before.json> <after.json>');
  process.exit(2);
}
// The task file the runs used (a third argument overrides it).
const runTaskFile = JSON.parse(fs.readFileSync(aFile, 'utf8')).summary.taskFile || 'tasks.json';
const { tasks } = JSON.parse(fs.readFileSync(taskArg ? path.resolve(taskArg) : path.join(__dirname, runTaskFile), 'utf8'));
const taskById = new Map(tasks.map((t) => [t.id, t]));

function load(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const r of data.results) {
    const t = taskById.get(r.id);
    if (t) Object.assign(r, score(t, r.answer));
  }
  data.summary.passed = data.results.filter((r) => r.pass).length;
  return data;
}
const A = load(aFile);
const B = load(bFile);
const byId = new Map(A.results.map((r) => [r.id, r]));

const rows = [];
for (const b of B.results) {
  const a = byId.get(b.id);
  if (!a) continue;
  rows.push({ id: b.id, split: b.split, before: a.pass ? 'pass' : 'FAIL', after: b.pass ? 'pass' : 'FAIL', sec: `${a.seconds} -> ${b.seconds}`, calls: `${a.calls} -> ${b.calls}`, tokens: `${a.tokens} -> ${b.tokens}` });
}
console.table(rows);

for (const split of ['opt', 'holdout']) {
  const r = rows.filter((x) => x.split === split);
  if (!r.length) continue;
  const pa = r.filter((x) => x.before === 'pass').length;
  const pb = r.filter((x) => x.after === 'pass').length;
  const fixed = r.filter((x) => x.before === 'FAIL' && x.after === 'pass').map((x) => x.id);
  const broke = r.filter((x) => x.before === 'pass' && x.after === 'FAIL').map((x) => x.id);
  console.log(`${split}: ${pa}/${r.length} -> ${pb}/${r.length}` + (fixed.length ? ` | fixed: ${fixed.join(', ')}` : '') + (broke.length ? ` | BROKE: ${broke.join(', ')}` : ''));
}
const s = (x) => `${x.passed}/${x.total} passed, median ${x.medianSeconds}s, ${x.meanCalls} calls and ${x.meanTokens} tokens per task`;
console.log(`before (${A.summary.workflow}): ${s(A.summary)}`);
console.log(`after  (${B.summary.workflow}): ${s(B.summary)}`);
