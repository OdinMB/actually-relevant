# Cloud evals: a strict per-task spend cap and a stories-only database copy

_Owner decision 2026-11-26: "yes to limited db sync for cloud dev purposes, and strict per-task caps"._

Evals are to run in cloud sessions too. The cloud environment injects the OpenAI and Tavily keys
through its proxy (commands set `OPENAI_API_KEY=proxy`, `TAVILY_API_KEY=proxy`; the real keys are
never visible). Two things are missing: a spend limit that cannot be overrun, and data.

The OpenAI project behind the cloud key has a hard monthly limit; it is the backstop, not the
per-task guarantee (its enforcement is not instant).

## Part A: strict per-task spend cap

### Behavior

- A **task cap** is a named, fixed USD amount created once (`npm run eval:cap --prefix server -- new <name> --usd <n>`;
  `show <name>` prints cap, settled spend, open reservations, remaining). Its amount can never be raised;
  a bigger budget is a new cap.
- Every eval command that can make a paid call (`eval:models`, `eval:recalibrate`, `eval:research`,
  `eval:overviews`, and any other script under `scripts/eval/` that reaches OpenAI or Tavily) takes
  `--cap <name>` (or `EVAL_SPEND_CAP=<name>`). **Without a cap, a live (uncached) paid request is refused.**
  Cached, `--dry-run`, `--cache-only` and `--rescore` runs need no cap.
- The guarantee: at every moment, settled spend + open reservations ≤ cap. A request is sent only after
  its **worst-case cost is reserved**; when it answers, the reservation is replaced by its real cost.
  Several commands of one task share one cap, run one after another (a second process on a cap that is
  in use refuses to start, unless the first process is dead).
- When a request's reservation does not fit: if other requests of this process are in flight and their
  release could make room, wait; otherwise refuse it with a typed error (`SpendCapReached`). The eval
  harness answers such a call `skipped` with the existing `BUDGET_EXHAUSTED`-style reason so reports
  stay readable ("stopped at the spend cap"); production code run inside an eval sandbox sees the error
  as a failed call. Each command's console and report state the cap, what this command spent, and what
  is left.
- The existing `--budget` (folder ledger, estimate-based, at most $20) stays as it is: it is planning.
  The cap is the guarantee. Keep both and say so in the docs.
- Production is untouched: with no cap installed in the process, the fetch paths behave exactly as today.

### Where it is enforced

At the two HTTP choke points, so production pipeline code that an eval runs (research passes,
overview sandboxes) is covered too, and so are the SDK's own retries (each attempt passes through):

- `server/src/services/openaiFetch.ts` (every OpenAI request: chat completions, responses, embeddings).
- Tavily: `server/src/lib/tavily.ts` and the eval's `scripts/eval/research/tavily.ts` (check for any other
  Tavily caller and route it through the same guard).
- Page fetches of sources are free and not counted.

The cap itself is one small module (e.g. `server/src/lib/spendCap.ts`): install once per process from the
CLI, `reserve`/`settle`, the ledger file, the lock. Pure pricing functions go beside it or reuse the eval's
price table (`scripts/eval/models.ts` `MODELS`, `costOf`); keep one price table, moving it to `lib/` if
`services/` must not import from `scripts/`.

### Worst-case reservation (must be an upper bound, never an estimate)

- **Chat / responses request:** input tokens ≤ UTF-8 byte length of the whole request body (every token is
  at least one byte; JSON escaping only adds bytes) plus a fixed overhead allowance (e.g. 256 tokens);
  priced at the input rate × the cache-write factor (the dearest way an input token is billed). Output
  tokens ≤ `max_completion_tokens` / `max_output_tokens` if the body sets one, else the model's maximum
  output (GPT-6 family: 128,000, per OpenAI's GPT-6 docs; record the source per model). Priced at the
  standard tier (flex is cheaper, so standard is the bound). Unknown model id → refuse, never guess.
  Do not add `max_completion_tokens` to requests: `llm.ts` forbids `maxTokens` for GPT-6 and the eval
  measures production's exact request.
- **Embeddings:** input bound as above at the embedding model's price (add it to the price table with its
  source); no output.
- **Tavily:** credits are determined by the request (search: basic 1, advanced 2; extract: per started
  block of 5 URLs, basic 1, advanced 2; check Tavily's current pricing page and the existing
  `CREDITS_PER_SEARCH` constants), at `TAVILY_USD_PER_CREDIT`, free credits counted as paid.
- **Settling:** a 2xx answer settles at its real cost from `usage` (priced with `costOf`, standard tier);
  a 2xx without readable usage settles at the full reservation; a 4xx settles at 0 (OpenAI and Tavily do
  not bill rejected requests); a 5xx, timeout, abort or network error settles at the **full reservation**
  (it may have been billed). Tavily settles at the reservation unless the answer reports credits used.

### Durability

- The cap's ledger is an append-only file next to the eval outputs (gitignored), one line per event:
  `created`, `reserved` (id, usd), `settled` (id, usd). Each line is written synchronously before the
  request is sent / after it answers. On load, a reservation without a settlement counts at its full
  amount (a crash never under-counts).
- The lock: a lock file holding the pid, taken at install, released at exit; a stale lock (dead pid) is
  taken over, its open reservations staying counted in full.

### Tests (TDD)

Reservation math per request kind (body bytes, max-output fallback, explicit max tokens, unknown model
refused, Tavily credit counts); fit / wait / refuse; settle rules per status; crash recovery counts
unsettled reservations; immutability of the amount; the lock; no-cap refusal of live calls while cached
runs pass; openaiFetch unchanged with no cap installed; concurrency (many parallel reservations never
exceed the cap).

### Docs

`.context/model-eval.md` ("Spend: the task cap and the folder budget", and what the guarantee does
**not** cover: requests made outside this code, e.g. a hand-written curl; a wrong price table or model
maximum), the CLAUDE.md commands list (`eval:cap`), and an ADR (strict per-task eval spend cap enforced
at the HTTP layer by worst-case reservation). Follow the existing ADR file format in `.context/decisions/`.

## Part B: stories-only database copy for cloud evals

### Behavior

- **Export** (run locally by the owner against his local database, which holds a production snapshot):
  `npm run db:export:eval --prefix server -- --out <file>`. Reads through the eval's read-only session
  (`scripts/eval/readOnlyDb.ts`). Writes one compressed file (gzip JSONL or similar) and prints row counts
  per table and the file size.
- **Import** (run in the cloud): `npm run db:import:eval --prefix server -- --in <file>` into a database
  named by `EVAL_DATABASE_URL` that must be local and whose name ends in `_eval` (mirror the
  `synthetic-data/guard.ts` rule; it empties the target). It applies the repo's migrations to that database
  first (reuse the `db:prepare` machinery or `prisma migrate deploy` against that URL through an npm script,
  never `npx prisma` by hand), then loads the rows in FK order. Vectors round-trip exactly.
- **Allowlist, not denylist.** Only the tables the evals read: stories and what hangs off them (embeddings,
  clusters, issues, feeds and favicons if referenced), research runs, context runs/facts/boxes/search cache,
  research passes and the evidence pool (searches, sources, pool facts, article versions, pass boxes),
  overviews and their entries, stands and decisions. Check `scripts/eval/` for every table it queries and
  make sure each is in. Never: users, refresh tokens, pending subscriptions, feedback, admin notices,
  newsletter sends, newsletters, podcasts and their usage, job runs and spend, social posts,
  edition switches.
- **Every column of every exported table is classified** in one place (export / scrub). Person-identifying
  columns (an editor's id or email in `*_by` fields such as `frozen_by`, `recentered_by`, `joined_by`,
  `detached_by`, `undone_by`, `locked_by`, or anything else that names a person) are scrubbed: system
  markers (e.g. `auto`, a job name) stay, anything else becomes a fixed placeholder like `editor`. A unit
  test fails when the Prisma schema gains a table or a column that the classification does not name, so a
  future personal-data column cannot leak silently.
- Rows in exported tables that reference excluded tables keep only scrubbed values; the import must not
  fail on FKs to excluded tables (null them, or there are none; check).

### Tests

Classification fence test against the schema; scrub rules; guard on the import target; a DB round trip
(`*.db.test.ts`, export from the test DB fixture and import into a second `_eval`... or into the test
database under the guard's test override, whatever the DB-test conventions allow) proving rows, vectors
and scrubbing survive.

### Docs

`.context/database-migrations.md` (or `model-eval.md`, whichever fits): what the copy holds and never
holds, how to export locally, how the cloud imports it, where the file lives in the cloud
(`/mnt/project-files/eval-db/`, outside the repo; the copy is never committed). CLAUDE.md commands list.

## Out of scope

No `.github/` change, no workflow runs, nothing in `pm/`. No change to production behavior.
