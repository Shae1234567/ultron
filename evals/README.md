# Evaluations

How Ultron's workflow changes are judged before they're promoted, so "smarter" is a measured claim, not a feeling.

## What's here

| File | What it is |
|---|---|
| `tasks.json` | 21 representative tasks. Each has an exact, machine-checkable score: `all` patterns must appear in the final answer, and `none` patterns (a wrong or contradicting value, or an invented specific) must not. |
| `hard-tasks.json` | 16 harder multi-step problems for the program solver (workflow v3): word problems, logic puzzles, calendar and clock arithmetic. Every answer was checked by brute force or exact arithmetic before the task was added. Its holdout has since been looked at while fixing the scorer and the solver, so it no longer counts as unseen. |
| `hard2-tasks.json` | 12 fresh held-out hard problems, written on 30 Sep 2026 after the last solver change and before any version was run on them. Every answer was brute-force checked; the race puzzle needed a fifth clue to have only one solution. This set is the final judge of v3 and was never tuned on. |
| `run.cjs` | Drives Ultron through the tasks with Playwright. It records pass/fail, seconds, model calls and tokens for each task, taken from the `cost:` line every request logs, plus what was verified and the activity log. |
| `compare.cjs` | Compares two result files task by task, per split: what got fixed, what broke, and time and cost. |
| `results/` | Result files from runs. |

Categories: calculation, units, dates, algebra, reasoning, research-reading and abstention.

The research-reading tasks use long local pages served by `run.cjs` from `evals/pages/`, rebuilt with `node evals/pages/make-pages.cjs`. The answer sits 15,000–27,000 characters in, and some pages have a decoy near the top, such as the U13 rule where the question is about U15.

Abstention means questions Ultron has no data for, where the right answer is "I don't know", not an invented mark.

## The splits

- `opt`: 12 tasks in `tasks.json` and 8 in `hard-tasks.json` that may be used to find and fix problems, or to tune prompts and workflow.
- `holdout`: 9 tasks in `tasks.json` and 8 in `hard-tasks.json`, used only to judge a change. Never tune on them.

Fixes found during evaluation, and where:
- Python written into the JavaScript sandbox, and a lead loop that ran out of rounds and answered "Done.". Found on `quiz-average` (opt).
- The page reader's missing default focus. Found on `read-long-news`, which was a held-out task. It was then moved to `opt`, because it had been seen, and a new held-out page (`read-long-calendar`) replaced it.
- The focused text being clipped to the local model's 2,800-character result budget. Found on the `read-long-*` opt tasks.
- Hard set, opt tasks (29–30 Sep):
  - In the solver, a crashed or NaN program now gets one self-repair, answers are compared by value, and more programs are drawn when fewer than two agree (`trains-meet`).
  - The reply must lead with the agreed answer (`not-enough-time`).
  - The sandbox's `timeOfDay()` stops programs formatting am/pm themselves (`trains-meet`).
  - Explanations are kept to two or three sentences (`not-enough-time`, where the model re-did the sum in words).
- Hard set, from a held-out task: the solver never ran on a geometry word problem (`rectangle-area`). The fix added area, perimeter and similar words to `wantsSolver`. That task was then seen, which is one reason the fresh `hard2-tasks.json` exists.

Hard-set scoring was corrected three times, each time because a correct answer had failed or a contradicting one had passed. The notes are in `hard-tasks.json` under `changes`:
- `dice-8` accepts "five thirty-sixths";
- `christmas-day`'s wrong-day rule looks only at the day given for December 25. Twice it had fired on true side facts: "starting from Tuesday, September 29" and "January 1 was a Thursday";
- `not-enough-time` rejects "N minutes left for gaming";
- `score.cjs` reads "**–5**" as −5.

`compare.cjs` re-scores every saved run with the current rules.

Scoring was changed once after the first runs (tasks.json v2): spoken answers are accepted ("x equals 19", "two dollars and twenty-five cents"), "−x = 19" is rejected, and curly apostrophes are normalized. `compare.cjs` re-scores every saved run with the current rules, so v1 and v2 are always judged the same way.

## Running

The dev app must use an isolated profile, never the real one. Create one with a `settings.json` that points the vault at a scratch folder, and give it no keys; it will then run on the local model.

```bash
npx vite build
node evals/run.cjs --workflow v1 --split all --profile C:\path\to\test-profile --out evals/results/v1-all.json
node evals/run.cjs --workflow v2 --split all --profile C:\path\to\test-profile --out evals/results/v2-all.json
node evals/compare.cjs evals/results/v1-all.json evals/results/v2-all.json
```

- Each task starts in a fresh conversation, with a fresh, empty memory vault (`--keep-memory` turns this off). The first runs didn't, and it mattered:
  - "What mark did I get on my September 3 science quiz?" was answered "81". The number came first from the previous task's question in the same conversation, then from the memory the eval itself had filed.
  - Isolated runs measure the workflow, not what earlier tasks taught it.
- `--only id1,id2` runs selected tasks, and `--tasks evals/hard-tasks.json` runs the hard set (`compare.cjs` finds the task file from the result).
- `--app installed` drives the installed Ultron on the real profile: real keys, real Gemini quota, and entries in the real vault. Use it deliberately, for a few Gemini-only checks.
- `--workflow` is written into the profile's settings for the run and restored afterwards. Any approval request is denied.

## Versioned, reversible workflow

`electron/brain/workflow.ts` names each improvement as a switch. `v1` is the behaviour before 28 Sep 2026; `v2` adds verification, the new tools, deeper research and better memory; `v3` is `v2` plus the program solver (`brain/solver.ts`). The active version is a setting (Settings → Team → Workflow version), so a change is:

1. versioned: a new flag, or a new version entry;
2. tested: unit tests, plus this evaluation against the previous version;
3. reversible: switch back in Settings, with no code change needed.

A version is promoted (made the default) only if it passes at least as many held-out tasks as the one before and breaks none, at a latency and cost that are worth it.

## Results (28–30 Sep 2026, local model qwen3.5:4b, isolated profile)

| Set | v1 (before 28 Sep) | v2 | v3 (program solver) |
|---|---|---|---|
| `tasks.json`, 21 everyday tasks, 3 runs each | 38/61 (holdout 18/25) | 56/61 (holdout 23/25) | not run |
| `hard-tasks.json`, 16 hard problems | 23/32 (2 runs) | 40/48 (3 runs) | 41/48 (3 runs)* |
| `hard2-tasks.json`, 12 fresh held-out hard problems, 2 runs each | 15/24 | 21/24 | 20/24 |
| median seconds per task (hard2) | 5–8 | 6 | 15–17 |
| tokens per task (hard2) | 8.7k–12.4k | 12k–15k | 12k–13.6k |

\* v3's first hard-set run used the first solver version, before the repair, top-up and answer check were added.

What it means:
- **Against Ultron before 28 Sep (v1), the new reasoning makes 2–5× fewer mistakes:**
  - everyday tasks: 23 → 5 mistakes (4.6×);
  - fresh hard problems: 9 → 3 for v2 (3×) and 9 → 4 for v3 (2.25×).
- **v3 did not beat v2.** It was one ahead on the hard set, one behind on the fresh set, and 2–3× slower. By the rule above it is not the default. v2 stays the default, and v3 is a choice in Settings (V3 - SOLVER).
- The local model already gets most of these right with v2's compute-first rule. So the solver's votes mostly confirm answers, and it adds its own failures:
  - two programs printed the same race result in a different order and were counted as disagreeing;
  - the solver never ran on a bus-timetable question;
  - on one date question the lead overruled three agreeing programs ("Wednesday" when all three said Tuesday), and the answer check was too loose to catch it.

Changes after the final measurement, not reflected in any number above: an assignment answer is compared in any order, since "Wes 1, Zoe 2…" and "Zoe 2, Wes 1…" are one answer. The other two weaknesses are known, not fixed. Judging a fix to them needs another unseen set, because the problems that exposed them have now been looked at.

## DSPy and GEPA: assessed, not adopted (yet)

- **DSPy** (github.com/stanfordnlp/dspy, MIT, active) optimizes prompts for programs written with its Python Signatures and Modules. Ultron's pipeline is TypeScript in Electron, so using DSPy would mean rewriting the team in Python. That's not justified by any gap found here.
- **GEPA** (github.com/gepa-ai/gepa, MIT, active) is a better fit on paper. Its `optimize_anything` / `GEPAAdapter` interface can evolve any text component, such as a system prompt, against a custom evaluator. This harness is that evaluator. The blocker is budget:
  - GEPA needs roughly 100–500 scored rollouts, and each rollout here is a full Ultron request of 3–15 model calls.
  - On Gemini's free tier that is thousands of requests, beyond its daily limits.
  - On the local model it would take many hours per round.

  The tasks, splits and scorer here are the pieces GEPA needs. It can be pointed at them once there's quota for it, with any prompt it proposes kept as a versioned workflow entry and promoted by the same held-out rule.
