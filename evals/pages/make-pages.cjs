// Builds the long local pages used by the research-reading tasks. The answer sits past the first 20,000
// characters - where a page cut at its start (read_webpage's old behaviour) never reaches.
//   node evals/pages/make-pages.cjs
const fs = require('node:fs');
const path = require('node:path');

const topics = ['the clubhouse renovation', 'the volunteer schedule', 'kit orders', 'the spring futsal league', 'referee courses', 'field bookings', 'the fundraising raffle', 'coaching licences', 'the parent committee', 'the end-of-season banquet'];
const verbs = ['was discussed at the board meeting', 'is now open for sign-ups', 'has a new coordinator', 'needs more volunteers', 'was moved to a new date', 'has updated guidelines', 'raised more than expected', 'will be reviewed in the new year'];
function filler(n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = topics[(i * 7 + seed) % topics.length];
    const v = verbs[(i * 3 + seed) % verbs.length];
    out.push(`<p>Update ${seed + i}: ${t} ${v}. Members asked a number of questions about ${topics[(i + seed + 3) % topics.length]}, and the organisers promised a fuller note in the next newsletter. Thanks to everyone who helped with ${topics[(i + seed + 5) % topics.length]} this month; it made a real difference to the club.</p>`);
  }
  return out.join('\n');
}

function page(title, dateIso, before, answer, after) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta property="article:published_time" content="${dateIso}"></head>
<body><article><h1>${title}</h1><p><time datetime="${dateIso}">${dateIso}</time></p>
${before}
${answer}
${after}
</article></body></html>`;
}

const dir = __dirname;
fs.writeFileSync(path.join(dir, 'club-news.html'), page(
  'Calgary Rangers - September club news', '2026-09-20',
  filler(90, 0),
  '<h2>Tier 3 tryouts</h2><p>The Tier 3 tryout results will be posted on October 4, 2026. Every player who tried out will be emailed by the technical director the same evening, before anything goes on the website.</p>',
  filler(60, 200),
));
fs.writeFileSync(path.join(dir, 'league-rules.html'), page(
  'Calgary Minor Soccer - League rules 2026-27', '2026-08-30',
  `<h2>U13</h2><p>U13 teams may dress five substitutes for a league game.</p>\n${filler(90, 400)}`,
  '<h2>U15</h2><p>U15 teams may dress up to seven substitutes for a league game, and substitutions are unlimited at any stoppage.</p>',
  filler(60, 600),
));
const events = ['Picture day', 'Band concert rehearsal', 'Parent-teacher interviews', 'Library book fair', 'Cross-country meet', 'Hot lunch', 'Spirit day', 'Math contest practice', 'Student council meeting', 'Early dismissal'];
const rows = (n, seed) => Array.from({ length: n }, (_, i) => `<tr><td>Week ${seed + i}</td><td>${events[(i * 3 + seed) % events.length]} for all grades - see the office for details, forms and any changes to the time or room.</td></tr>`).join('\n');
fs.writeFileSync(path.join(dir, 'school-calendar.html'), page(
  'Vincent Massey School - 2026-27 events calendar', '2026-09-02',
  `<table><tr><td>Grade 8 science fair</td><td>Grade 8 science fair on November 4, 2026 in the gym.</td></tr>\n${rows(130, 0)}`,
  '<tr><td>Grade 9 science fair</td><td>The Grade 9 science fair is on November 18, 2026, in the library, with judging from 1 to 3 pm.</td></tr>',
  `${rows(70, 300)}</table>`,
));

const stops = ['Brentwood Station', 'Dalhousie Station', 'Crowfoot Station', 'Market Mall', 'Foothills Hospital', 'University Station', 'Northland Mall', 'Varsity Estates', 'Silver Springs', 'Montgomery'];
const busRows = (n, seed) => Array.from({ length: n }, (_, i) => `<tr><td>Route ${100 + seed + i}</td><td>Leaves ${stops[(i * 3 + seed) % stops.length]} at ${6 + (i % 12)}:${String((i * 7) % 60).padStart(2, '0')} and runs every 20 minutes on school days; check the service alerts page before you travel.</td></tr>`).join('\n');
fs.writeFileSync(path.join(dir, 'bus-routes.html'), page(
  'Calgary Transit - school routes 2026-27', '2026-08-25',
  `<table><tr><td>Route 21</td><td>Route 21 leaves Vincent Massey School at 3:05 pm on school days.</td></tr>\n${busRows(110, 0)}`,
  '<tr><td>Route 12</td><td>Route 12 leaves Vincent Massey School at 3:35 pm on school days and stops at Brentwood Station at 3:52 pm.</td></tr>',
  `${busRows(60, 500)}</table>`,
));

for (const f of ['club-news.html', 'league-rules.html', 'school-calendar.html', 'bus-routes.html']) {
  const html = fs.readFileSync(path.join(dir, f), 'utf8');
  const text = html.replace(/<[^>]+>/g, '');
  const at = text.search(/Tier 3 tryout results will|U15 teams may dress|Grade 9 science fair is on|Route 12 leaves/);
  console.log(f, `${Math.round(text.length / 1000)}k chars of text, answer at ${at}`);
}
