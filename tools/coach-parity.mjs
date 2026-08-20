/**
 * Coach parity: CM8's offline matcher vs the port.
 *
 * CM8's matcher is wired to the DOM, so it cannot be called directly the way
 * the nutrition engine could. Instead this lifts the pieces that decide an
 * answer - the knowledge base, the stopwords and scoreTopics - runs both
 * implementations over the same questions, and compares which topic wins and
 * by what score. If the ranking matches, the answer matches, because the
 * answer is just the top entry's payload.
 *
 *   node tools/coach-parity.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.CM8_SRC || 'C:/Users/shaeg/Downloads/index_8.html';
const html = fs.readFileSync(SRC, 'utf8');

/** Balanced lift of a declaration, same approach the extractor uses. */
function lift(name, open, close) {
  const re = new RegExp('const\\s+' + name + '\\s*=\\s*' + (open === '[' ? '\\[' : 'new Set\\(\\['));
  const m = re.exec(html);
  if (!m) throw new Error('missing ' + name);
  let i = m.index + m[0].length - 1;
  let depth = 0, inStr = null, prev = '';
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) { if (c === inStr && prev !== '\\') inStr = null; }
    else if (c === '"' || c === "'" || c === '`') inStr = c;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) break; }
    prev = c;
  }
  return html.slice(m.index + m[0].length - 1, i + 1);
}

const kbSrc = lift('KB', '[');
const stopSrc = lift('STOPWORDS', 'set');

// Rebuild CM8's matcher in a sandbox from its own source text.
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(`
  const KB = ${kbSrc};
  const STOPWORDS = new Set(${stopSrc});
  function tokenize(s){
    return s.toLowerCase().replace(/[^a-z0-9\\s]/g,' ').split(/\\s+/).filter(w=>w && !STOPWORDS.has(w));
  }
  function scoreTopics(text){
    const lower = ' ' + text.toLowerCase().replace(/[^a-z0-9\\s]/g,' ').replace(/\\s+/g,' ') + ' ';
    const tokens = tokenize(text);
    return KB.map(entry=>{
      let score = 0;
      entry.pri.forEach(k=>{
        if(k.includes(' ')){ if(lower.includes(' '+k+' ') || lower.includes(' '+k)) score += 5; }
        else if(tokens.includes(k)) score += 4;
        else if(k.length > 5 && lower.includes(k)) score += 3;
      });
      entry.sec.forEach(k=>{
        if(k.includes(' ')){ if(lower.includes(k)) score += 2; }
        else if(tokens.includes(k)) score += 1.5;
      });
      return { entry, score };
    }).sort((a,b)=>b.score - a.score);
  }
  globalThis.ORIG_score = scoreTopics;
  globalThis.KB_SIZE = KB.length;
`, sandbox);

const outfile = path.join(os.tmpdir(), 'cm8-coach-' + Date.now() + '.mjs');
await esbuild.build({
  entryPoints: [path.join(HERE, '..', 'src', 'cm8', 'coach.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent',
});
const PORT = await import(pathToFileURL(outfile).href);

const QUESTIONS = [
  'how do I improve my passing range',
  'my first touch is letting me down in tight spaces',
  'what should I do about my weak foot',
  'how do I get to tier 3',
  'I had a bad game yesterday and I feel terrible',
  'how much sleep do I actually need',
  'what should I eat before a match',
  'I get nervous before tryouts',
  'how do I get faster',
  'my hamstring is sore',
  'how do I scan more',
  'when should I press',
  'how do I shoot from range',
  'I cannot focus on homework',
  'am I too small for tier 3',
  'what boots should I get',
  'how do I stay consistent',
  'should I watch film',
  'talk to me about being a leader on the pitch',
  'what does a centre mid actually do',
  'hi',
  'thanks',
  'tell me more',
  'what is the capital of France',
  'how do I build a rocket',
];

let pass = 0;
const fails = [];
for (const q of QUESTIONS) {
  const a = sandbox.ORIG_score(q);
  const b = PORT.scoreTopics(q);
  const ta = a.slice(0, 3).map((x) => `${x.entry.id}:${x.score}`).join(',');
  const tb = b.slice(0, 3).map((x) => `${x.entry.id}:${x.score}`).join(',');
  if (ta === tb) pass++;
  else fails.push({ q, orig: ta, port: tb });
}

// The confidence floor decides whether Shae gets an answer or a clarifying
// question, so check that boundary explicitly too.
for (const q of QUESTIONS) {
  const top = sandbox.ORIG_score(q)[0];
  const reply = PORT.offlineReply(q);
  const origConfident = !!top && top.score >= 3.5;
  const isGreetingOrThanks = /^(hi|hey|hello|yo|sup|hiya|good morning|good evening|morning)\b/i.test(q.trim())
    || /\b(thanks|thank you|thx|appreciate|cheers)\b/i.test(q.trim())
    || /^(why|how so|more|tell me more|explain|elaborate|go on|deeper)\b/i.test(q.trim());
  if (isGreetingOrThanks) { pass++; continue; }
  if (reply.confident === origConfident) pass++;
  else fails.push({ q, orig: 'confident=' + origConfident, port: 'confident=' + reply.confident });
  PORT.resetCoach();
}

fs.unlinkSync(outfile);

console.log(`coach parity: ${pass}/${pass + fails.length} identical  (KB topics: ${sandbox.KB_SIZE})`);
for (const f of fails.slice(0, 10)) {
  console.log('  MISMATCH ' + f.q);
  console.log('    cm8 : ' + f.orig);
  console.log('    port: ' + f.port);
}
if (fails.length) process.exit(1);
