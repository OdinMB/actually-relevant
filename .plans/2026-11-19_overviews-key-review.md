# Reviewing the drafted answer-key items (2026-11-19)

Step 1 of the overviews eval plan (`2026-11-19_overviews-eval-runbook.md`, beside this file) has a model draft one kind of item into the five judged answer keys: **what is being done** about each development, as each story reports it. These are the test cases for a bar that has none today: "What's being done" present (step 5). Nothing counts until you have checked it: step 5 refuses to run while one item is still unchecked. (Until 2026-11-22 it drafted each development's end too, for a closing bar; ADR-0072 removed the end-event closing, the bar and the drafted end.)

**Time:** about 30–45 minutes for the five developments, plus 5 minutes of commands. Expect roughly 60–110 items, at most one per story, most of them for Ebola and El Niño. One item takes 10–20 seconds: its quote is right beside it, so you rarely need to open the story.

## Where the items are

- **To read:** the report `DOCS/2026-11-19_key-drafts/overview-eval-steps-key-draft-half-judge.md`. One section per development: a table of the items (date, story title, what is being done, the quote) and what code threw out.
- **To mark:** the key files themselves, `server/src/scripts/eval/overviews/keys/<development>.json`: the items are in the `responses` list near the end of the file. Run `npm run format --prefix server` first; then `git diff` shows exactly what was added and nothing else.

Code has already checked that each quote is really in its story, that the story belongs to the development, and dated each item by its story. You judge only what the words mean.

## What to check

**Each "what is being done" item** (`date`, `what`, `slug`, `quote`, `reviewed`):

- **Is it being done?** Under way on that day, by someone named: aid delivered, vaccinations given, a ban in force, troops or teams deployed, a court case under way, money pledged. Delete it if it is only a call for action, a warning, a forecast, a plan or proposal not yet acted on, or a meeting still to come.
- **Is it about this development?** A response to this outbreak, this war, this negotiation; not to something next to it.
- **Does the quote say what `what` says?** If `what` overstates the quote, shorten `what` or delete the item.

You don't need to check completeness: a missed item only means one test case fewer, never a wrong result.

## How to mark each item

- **Keep it:** change `"reviewed": false` to `"reviewed": true`.
- **Throw it out:** delete the whole `{ … }` block of that item, and the comma before it.
- **Correct it:** edit `what` (leave `quote` exactly as it is: it must stay the story's own words), then mark it `true`.
- **Shortcut per file:** once you have read every item of a file and deleted the wrong ones, replace every `"reviewed": false` in that file with `"reviewed": true`.
- **Add one by hand** (optional): copy an item, set the story's `slug`, its `date` (the story's entry date in the same file), the story's exact words as `quote`, and `"reviewed": true`.

## When you are done

```bash
npm run format --prefix server
npm run eval:overviews --prefix server -- --out ../DOCS/2026-11-19_linking-eval --steps keys
```

In the report's "Answer keys" table, "To review" reads 0 for the five judged developments, and no error says "quote not found" or "format". A typo in the JSON (a missing comma) shows up there as a format error; a key with errors is left out of every later step, so fix it before going on. Then commit the five key files (or ask a session to), and go on with step 2 of the plan.
