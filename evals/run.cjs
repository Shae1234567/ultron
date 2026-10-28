#!/usr/bin/env node
// Runs the evaluation set against Ultron and scores it: quality (the task's own patterns), time, and cost
// (model calls and tokens, from the "cost:" line every request logs).
//
//   node evals/run.cjs --workflow v2 --split holdout --out evals/results/v2-holdout.json
//
// --app dev (default) drives the built dev app (run `npx vite build` first) on an ISOLATED profile given by
// --profile or ULTRON_EVAL_PROFILE - never your real one. --app installed drives the installed Ultron with its
// real profile (real keys, real quota, entries in the real vault); use it only on purpose.
// --workflow is written into that profile's settings before the run and put back afterwards.
// Any approval request during an eval is denied: these tasks never need one.
const path = require('node:path');
const fs = require('node:fs');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const ROOT = path.resolve(__dirname, '..');
const workflow = args.workflow || 'v2';
const split = args.split || 'all';
const appKind = args.app || 'dev';
const profile = args.profile || process.env.ULTRON_EVAL_PROFILE || '';
const only = (args.only || '').split(',').filter(Boolean);
const timeoutMs = Number(args.timeout || 420) * 1000;
// Fresh, empty memory for every task (default on the dev app; --keep-memory to test with what the profile knows).
const freshVaults = appKind === 'dev' && args['keep-memory'] !== 'true'
  ? path.join(require('node:os').tmpdir(), 'ultron-eval', `${workflow}-${Date.now()}`)
  : '';
const outFile = args.out || path.join(ROOT, 'evals', 'results', `${workflow}-${split}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`);

if (appKind === 'dev' && !profile) {
  console.error('Give an isolated test profile with --profile <dir> (or ULTRON_EVAL_PROFILE). The dev app must never run on your real profile.');
  process.exit(2);
}

const { _electron: electron } = require(path.join(ROOT, 'node_modules', 'playwright'));
// --tasks picks another task file, e.g. evals/hard-tasks.json.
const TASK_FILE = args.tasks ? path.resolve(args.tasks) : path.join(__dirname, 'tasks.json');
const { tasks } = JSON.parse(fs.readFileSync(TASK_FILE, 'utf8'));
const chosen = tasks.filter((t) => (split === 'all' || t.split === split) && (!only.length || only.includes(t.id)));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const { score } = require('./score.cjs');

function costOf(lines) {
  const line = [...lines].reverse().find((l) => /^cost: /.test(l)) || '';
  const calls = Number(/(\d+) model calls?/.exec(line)?.[1] ?? NaN);
  const tokens = (() => {
    const m = /(\d+)(k?) tokens/.exec(line);
    return m ? Number(m[1]) * (m[2] ? 1000 : 1) : NaN;
  })();
  return { calls, tokens };
}

async function runTask(page, task) {
  // Every task starts in a fresh conversation AND an empty memory vault - in the first runs, "what mark did I get
  // on my quiz?" was answered with numbers from an earlier task, first through the conversation, then through the
  // memory the eval itself had written. (A late memory write from task N lands in task N+1's vault only after
  // N+1 has finished - extraction waits until the team is idle - so it can't leak into a scored answer.)
  if (freshVaults) {
    const dir = path.join(freshVaults, task.id);
    fs.mkdirSync(dir, { recursive: true });
    await page.evaluate((p) => window.ultron.settings.save({ vault: { path: p } }), dir);
  }
  await page.evaluate(() => window.__ultron.clearTranscript());
  await page.waitForTimeout(300);
  const t0 = Date.now();
  const before = await page.evaluate(() => window.__ultron.state().transcript.length);
  // The HUD keeps only the last 160 log lines, so "lines since" is found by the last line's id, not a count.
  const lastId = await page.evaluate(() => { const l = window.__ultron.state().team.log; return l.length ? l[l.length - 1].id : null; });
  await page.fill('.composer input', task.prompt.replace('{{BASE}}', BASE));
  await page.press('.composer input', 'Enter');
  await page.waitForTimeout(1500);
  let denied = 0;
  let timedOut = true;
  while (Date.now() - t0 < timeoutMs) {
    if (await page.$('.approval')) {
      denied++;
      await page.click('.approval button:text-is("Deny")').catch(() => {});
      await page.waitForTimeout(1000);
      continue;
    }
    const busy = await page.evaluate(() => window.__ultron.state().team.phase !== 'idle' || document.querySelector('.caret') !== null).catch(() => true);
    if (!busy) { timedOut = false; break; }
    await page.waitForTimeout(1500);
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  const st = await page.evaluate(() => window.__ultron.state());
  const answer = st.transcript.slice(before).filter((m) => m.who === 'ultron').map((m) => m.text).join(' ').replace(/\s+/g, ' ').trim();
  const from = lastId ? st.team.log.findIndex((l) => l.id === lastId) : -1;
  const lines = st.team.log.slice(from + 1).map((l) => l.text);
  const s = score(task, answer);
  return {
    id: task.id, split: task.split, category: task.category, pass: s.pass, missing: s.missing, wrong: s.wrong,
    seconds, timedOut, denied, ...costOf(lines),
    verified: lines.filter((l) => /^verified: /.test(l)).map((l) => l.slice(10)),
    tools: [...new Set(lines.filter((l) => /^(calc |run code|google |search |read |recall )/.test(l)).map((l) => l.split(/[ ("]/)[0] + (l.startsWith('run code') ? ' code' : '')))],
    answer: answer.slice(0, 1200),
    log: lines.slice(0, 40).map((l) => l.slice(0, 300)),
  };
}

// Research-reading tasks read long local pages (evals/pages) from a server on this PC - no internet needed,
// and the answer is always in the same place on the page.
const PAGES = path.join(__dirname, 'pages');
let BASE = '';
function servePages() {
  const server = require('node:http').createServer((req, res) => {
    const file = path.join(PAGES, path.basename(decodeURIComponent((req.url || '/').split('?')[0])));
    if (!file.endsWith('.html') || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    BASE = `http://127.0.0.1:${server.address().port}`;
    resolve(server);
  }));
}

(async () => {
  const pageServer = await servePages();
  const launch = appKind === 'installed'
    ? { executablePath: path.join(process.env.LOCALAPPDATA, 'Programs', 'ultron', 'Ultron.exe'), args: ['--mute-audio'], timeout: 90_000 }
    : {
      executablePath: path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [ROOT, '--mute-audio', '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
      cwd: ROOT,
      env: { ...process.env, ULTRON_USER_DATA: profile },
      timeout: 60_000,
    };
  const app = await electron.launch(launch);
  const page = await app.firstWindow();
  await page.evaluate(() => { window.speechSynthesis.speak = () => {}; }).catch(() => {});
  await page.waitForSelector('.composer input', { timeout: 90_000 });
  await page.waitForTimeout(6000);
  const original = await page.evaluate(() => window.ultron.settings.get());
  await page.evaluate((w) => window.ultron.settings.save({ workflow: w }), workflow);
  const brain = await page.evaluate(() => { const b = window.__ultron.state().brain; return b && { provider: b.active, model: b.model }; });
  log(`workflow ${workflow} | split ${split} | ${chosen.length} tasks | brain ${JSON.stringify(brain)} | thinking ${original.thinking}`);

  const results = [];
  try {
    for (const task of chosen) {
      const r = await runTask(page, task);
      results.push(r);
      log(`${r.pass ? 'PASS' : 'FAIL'} ${task.id} (${r.seconds}s, ${r.calls} calls, ${r.tokens} tokens)${r.pass ? '' : ` missing=${JSON.stringify(r.missing)} wrong=${JSON.stringify(r.wrong)}`}`);
      await page.waitForTimeout(1200);
    }
  } finally {
    await page.evaluate((o) => window.ultron.settings.save({ workflow: o.workflow, vault: o.vault }), original).catch(() => {});
    await app.close().catch(() => {});
    pageServer.close();
  }
  const passed = results.filter((r) => r.pass).length;
  const summary = {
    workflow, split, app: appKind, brain, taskFile: path.basename(TASK_FILE), ranAt: new Date().toISOString(),
    passed, total: results.length,
    medianSeconds: median(results.map((r) => r.seconds)),
    meanCalls: mean(results.map((r) => r.calls)),
    meanTokens: mean(results.map((r) => r.tokens)),
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));
  log(`TOTAL ${passed}/${results.length} | median ${summary.medianSeconds}s | ${summary.meanCalls} calls, ${summary.meanTokens} tokens per task -> ${path.relative(ROOT, outFile)}`);
})().catch((e) => { console.error('EVAL FAILED:', e); process.exit(1); });

function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
}
function mean(xs) {
  const v = xs.filter(Number.isFinite);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}
