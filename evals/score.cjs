// One scorer for run.cjs and compare.cjs, so a scoring fix re-scores every saved run the same way.
// Ultron speaks its answers ("x equals 19", "two dollars and twenty-five cents", "Twenty-four weeks", curly
// apostrophes), so the answer is normalized first and the tasks accept spoken forms. Scoring changes
// (29 Sep 2026): spoken forms and curly quotes after the first v2 run; number words after the second.
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** "Twenty-four weeks" -> "24 weeks" (0-99), so a pattern like \b24\b finds a spoken number too. */
function wordsToDigits(text) {
  const tens = TENS.slice(2).join('|');
  return text
    .replace(new RegExp(`\\b(${tens})[- ](${ONES.slice(1, 10).join('|')})\\b`, 'gi'), (_, t, o) => String(TENS.indexOf(t.toLowerCase()) * 10 + ONES.indexOf(o.toLowerCase())))
    .replace(new RegExp(`\\b(${tens})\\b`, 'gi'), (t) => String(TENS.indexOf(t.toLowerCase()) * 10))
    .replace(new RegExp(`\\b(${ONES.join('|')})\\b`, 'gi'), (w) => String(ONES.indexOf(w.toLowerCase())));
}

function normalize(answer) {
  return answer
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    // Markdown bold and an en dash or maths minus before a number ("**–5**") read as plain "-5" (hard set, 29 Sep).
    .replace(/\*\*/g, '').replace(/[–−](?=\s*\d)/g, '-')
    .replace(/\s+/g, ' ').trim();
}

function score(task, answer) {
  const a = normalize(answer);
  // Patterns may match the answer as written or with its number words as digits.
  const both = `${a} ||| ${wordsToDigits(a)}`;
  const missing = task.all.filter((p) => !new RegExp(p, 'i').test(both));
  const wrong = task.none.filter((p) => new RegExp(p, 'i').test(a));
  return { pass: !missing.length && !wrong.length, missing, wrong };
}

module.exports = { score, normalize, wordsToDigits };
