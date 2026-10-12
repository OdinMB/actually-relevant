---
plan-id: 2026-10-12_feedback-ip-hmac-and-blueprint-values
title: Disclose the feedback form's data, key the feedback IP hash with a secret, fix known settings and the Node version in render.yaml under a blueprint test, and backlog the Docker move
status: implemented
created: 2026-10-12
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: [personal-data, handover]
decisions:
  - ref: .context/decisions/0036-fixed-values-and-blueprint-test.md
  - ref: .context/decisions/0037-feedback-ip-hmac.md
type: feature
complexity: complex
---

# Feedback IP disclosure and keyed hash; fixed settings, a pinned Node and a test for render.yaml

**Who decided what.** Five decisions are Odin Mühlenbein's, made in session on 2026-10-12. The session that launched the planner relayed them; the launching session recorded his approval below.

1. **Privacy page.** It gets a "Feedback Form" section with his copy, verbatim (below).
2. **Feedback hash.** The feedback `ipHash` becomes a keyed hash (HMAC-SHA256) under a new secret variable, centralized in `server/src/config.ts`. Old rows keep their old hashes, which will not match new ones. ADR-0037 records the HMAC and the secret.
3. **Blueprint values.** `render.yaml` follows the `render-side-project` skill: non-secret settings that are the same on every host become fixed values, at least `NODE_ENV=production` and `TRUST_PROXY="2"`. The hop count was measured on 2026-10-12 on both `actually-relevant-api.onrender.com` and `api.actuallyrelevant.news` (XFF `spoof, client, cloudflare-edge`). The skill's blueprint test is added, superseding ADR-0034's "every variable `sync: false`". ADR-0036 records the decision itself.
4. **Node version.** Node is pinned now for both Render services, at the version production runs today.
5. **Backlog.** `BACKLOG.md` gets the item "Move the backend to a Docker image behind CI (hybrid)".

Everything else is the planner's choice, and is labelled as such in ADR-0036 and ADR-0037 at promotion:

- refusing feedback rather than refusing to start when the secret is missing;
- having no development fallback key and no length check;
- which of the other variables stay `sync: false`;
- how the test finds the variables the code reads, and each adaptation of the skill's checks;
- the mechanism for pinning Node.

Confirmed by Odin Mühlenbein on 2026-10-12: ADR-0036, ADR-0037

Owner's answer (2026-10-12): both services run Node 22.22.0 today (backend log "Using Node.js version 22.22.0 (default)", static site log "Installing Node.js version 22.22.0..."); `NODE_VERSION` is set on neither service. So `<NODE>` = `22.22.0`. He also explicitly accepted that feedback is refused (503, nothing stored) rather than the server refusing to start when the secret is missing.

**Before implementation: one answer from the owner (answered above).** The Node version production runs today. The repository cannot tell (no `.node-version`, `.nvmrc`, `engines` or `NODE_VERSION` anywhere). The coordinator asks the owner for:

- the line in the latest deploy log of each service, backend and static site, that names the Node version Render used;
- whether `NODE_VERSION` is set on either service's Environment page.

The implementer writes that exact version, as `major.minor.patch`, wherever this plan says `<NODE>`. If the two services report different versions, the implementer stops and asks; it does not choose one.

## Problem

**The feedback form.** It stores the message, the category, an optional email and a hash of the visitor's IP, and the privacy page says nothing about it. That hash is an unsalted SHA-256, so anyone holding the table recovers every address by hashing all 2^32 IPv4 addresses.

**The blueprint.** `render.yaml` names every variable with `sync: false`, and nothing pins Node. So:

- the measured hop count (`TRUST_PROXY=2`) lives only in the dashboard;
- Render's default Node version can change under production without a commit;
- nothing notices when the code reads a variable that the blueprint, or `server/env.example`, does not name.

## Approach

### 1. Privacy page

**The new section.** Add a new `<h3>` "Feedback Form" section directly after the Newsletter section and before "Server Logs". It uses the same heading classes as its siblings (`text-lg font-normal mt-6 mb-2`) and holds one paragraph with the owner's copy, verbatim:

> If you send us feedback, we store your message, the category you chose, and your email address if you give one, so we can read and reply. We also store a hashed form of your IP address to spot repeated abusive submissions. We don't use it for anything else.

**Checked against the rest of the page:** nothing contradicts it, and the correctness review confirmed this.

- **The analytics bullets.** "Does **not** store your IP address" and "Does **not** collect personal data" sit under "Simple Analytics, a privacy-focused analytics service that:", so they are already scoped to Simple Analytics. They are left unchanged.
- **The rest of the page.** The intro, "Server Logs", "What We Store on Your Device" and the third-party table make no claim about the feedback form.
- **"Your Rights".** It says "we collect almost no personal data" and offers deletion of a newsletter address only. That is an omission, not a contradiction, and is out of scope.

### 2. Keyed feedback IP hash (ADR-0037)

**A new module, `server/src/lib/feedbackIpHash.ts`.** It follows `lib/turnstile.ts`: the secret policy and the boot log live in a `lib/` module, and the route only consumes the result. The route already validates, rate-limits, handles the honeypot and persists, so the key policy does not go there.

- It exports `hashFeedbackIp(ip: string): string | null`.
- It reads `config.feedback.ipHashSecret` at call time.
- With the secret empty, it returns `null`.
- Otherwise it returns `createHmac('sha256', secret).update(ip).digest('hex')`. That is still 64 hex characters, so the column and the admin view are unchanged.
- At module load, if the secret is empty, it logs once with `log.error`: "FEEDBACK_IP_HASH_SECRET is not set: feedback submissions will be refused".

**`config.ts`.** The `feedback` block gains `ipHashSecret: process.env.FEEDBACK_IP_HASH_SECRET || ''`.

**The route, `feedback.ts`.** After the honeypot check, it calls `hashFeedbackIp(ip)`. If the result is `null`, it answers 503 with `{ error: 'Feedback is unavailable right now. Please try again later.' }` and stores nothing.

**One rule in every environment: no secret, no feedback.**

- **No development fallback key.** A public key chosen by `NODE_ENV` would write brute-forceable hashes on any host whose `NODE_ENV` is wrong.
- **No length check.** A startup throw on a secret that is too short would block deploys. The README and `env.example` give `openssl rand -hex 32` instead.

**Refusing the submission rather than refusing to start.** Both fail closed. Refusing only feedback matches the `TURNSTILE_SECRET_KEY` precedent and keeps the blast radius to the feature that needs the secret.

**Other alternatives, rejected:**

- **A nullable column with no hash.** It needs a migration and drops the abuse signal the copy promises.
- **Reusing `JWT_SECRET` as the key.** Rotating it would silently change every future hash.

Old rows keep their unkeyed hashes (owner's decision).

### 3. `render.yaml`: fixed values and the blueprint test (ADR-0036)

**Which variables become fixed values.** The skill's rule:

- **A fixed `value:`** for settings that are not secret and are the same on every host.
- **`sync: false`** for secrets, per-stage values and canonical-address settings.

A fixed value overwrites the dashboard on every sync, so it must equal what production runs today:

| Variable | Service | Mode | Why |
|---|---|---|---|
| `NODE_ENV` | backend | `value: production` | `.context/deployment.md` and the README record it. |
| `TRUST_PROXY` | backend | `value: "2"` | Measured on 2026-10-12 on both hostnames (owner). |
| `NODE_VERSION` | both | `value: "<NODE>"` | Section 4: the version production runs today, read from the deploy logs. |
| Everything else | — | `sync: false` | See below. Never guessed. |

Every other variable stays `sync: false` because it is one of these:

- **A secret or a secret-shaped name.** This includes `WEBHOOK_URL`, whose URL embeds a token.
- **A canonical address:** `SITE_URL`, `CLIENT_URL`, `FRONTEND_URL`, `API_URL`, `VITE_API_URL`.
- **A switch:** `SUBSCRIPTIONS_ENABLED`, `*_AUTO_POST_ENABLED`, and `AUTH_COOKIE_SAMESITE`, which goes to `strict` after the API switch (ADR-0019).
- **A value production may set that the repository cannot see:** `LOG_LEVEL`, `EXTRACTION_API`, `PLUNK_FROM_NAME`, `MASTODON_URL`, `BLUESKY_HANDLE`, `BUNNY_STORAGE_ZONE`, `PLUNK_TEST_SEGMENT_ID`.

**Runbook changes.**

- A new step compares each fixed value with the dashboard before connecting.
- A non-secret value read off the dashboard at that point may become a fixed value in the same edit.

**`FEEDBACK_IP_HASH_SECRET`** is added with `sync: false`.

**The blueprint is not connected yet.** Its `FROM-DASHBOARD-…` placeholders are still in, so today the dashboard's values are what production runs. `TRUST_PROXY` must also be 2 there, and `NODE_VERSION` must also be `<NODE>` on both services (section 4).

**The header comment** is rewritten per the skill. It covers:

- the two modes and the rule;
- what is left out on purpose and why: the database (ADR-0035), secrets, test-only and local-only variables, and `domains:`;
- the `FROM-DASHBOARD-…` placeholders and the runbook that fills them;
- that a later-added variable is set by hand on the Environment page;
- that `server/src/blueprint.test.ts` holds the file;
- that `NODE_VERSION` must equal `.node-version`.

The "Never add a `value:`" paragraph goes.

#### The test, `server/src/blueprint.test.ts`

It uses Vitest, sits beside `config.test.ts` and adds no dependency. It reads these files as text: `render.yaml`, `.node-version`, `server/env.example`, `client/env.example`, `server/prisma/schema.prisma`, and the source.

**How it finds what the server reads.** The skill runs the settings loader against a recording `Proxy`, but here that would see only `config.ts`. Eleven other modules read `process.env` directly, several at call time (`app.ts`, `index.ts`, `middleware/auth.ts`, `routes/auth.ts`, `lib/turnstile.ts`, `lib/openapi.ts`, `lib/notify.ts`, `lib/logger.ts`, `services/favicon.ts`, `services/extractor.ts`, `services/auth.ts`). So the test scans the source instead:

- **Server reads.** Every `process.env.NAME` in `server/src/**/*.ts`. It leaves out `*.test.ts`, `src/test/` and `src/scripts/`, because `scripts/db-prepare` passes `process.env` whole.
- **A guard test.** In the scanned files, `process.env` is read only as `process.env.NAME`: no `process.env[`, no destructuring, no passing the whole object. The correctness review confirmed this holds today.
- **Prisma reads.** Every `env("NAME")` in `schema.prisma`.
- **`READ_BY_LIBRARIES = ['OPENAI_API_KEY']`.** Read by `@langchain/openai` and the `openai` SDK.
- **`READ_BY_RENDER = ['NODE_VERSION']`.** Render reads it to choose the runtime, so it may appear on both services though no code reads it.
- **A sanity assertion.** The result contains `TRUST_PROXY`, `JWT_SECRET`, `DATABASE_URL` and `FEEDBACK_IP_HASH_SECRET`.
- **Client reads.** Every `import.meta.env.VITE_[A-Z0-9_]+` in `client/src/**/*.{ts,tsx}`, tests excluded.

**Alternatives, rejected:**

- **A `Proxy` on `config.ts`.** It silently misses the other modules.
- **A `loadConfig(env)` refactor.** It touches a dozen modules and their tests.

**Two exclusion lists, each mapping a name to its reason.**

- **`NOT_IN_BLUEPRINT`:**
  - `PORT`: Render sets it.
  - `SCHEDULER_ENABLED`: only for a second process.
- **`RUNS_ON_ITS_CODE_DEFAULT`:** the roughly 70 tunables whose code default production runs, one line each.

**Accepted debt:** a new tunable is edited in `config.ts` and in this list. The test says so in a comment.

**The strict reader** works line by line and handles two services:

- **Service start.** A line matching `^  - type:` starts a service and records its `type`.
- **Service fields.** Lines at four spaces are recorded: `runtime`, `name`, `rootDir`, `branch`, `autoDeployTrigger`, `healthCheckPath`, `region`, `maxShutdownDelaySeconds`.
- **Inside `envVars:`.** Each entry starts `- key:` and carries `value:`, `sync:` or `generateValue:`. Quotes are stripped and inline comments dropped. Any other line that is not blank or a comment throws.
- **End of `envVars:`.** The list ends at the first line, not blank or a comment, that is indented no deeper than the key.

**The checks, adapted.** Each adaptation is commented in the test.

1. **Every read is named.** Every variable the server reads is in the backend's `envVars` or one of the two exclusion lists. Every `VITE_*` the client reads is in the static site's `envVars`.
2. **Nothing extra.** Neither service names a variable that its code, a library or Render does not read, or any name twice.
3. **Nothing forbidden.** The backend names nothing from the exclusion lists, no `TEST_*`, no `LANGSMITH_*` or `LANGCHAIN_*`, and no `VITE_*`. The static site names only `VITE_*` and `NODE_VERSION`.
   - *Adaptation:* Render builds the static site from source, and its `VITE_*` values are public by design.
4. **One mode per variable.** A non-empty `value` or `sync: false`, never both, and never `generateValue`.
5. **Secrets stay in the dashboard.** Names matching `PASSWORD|SECRET|KEY|TOKEN|EMAIL|DATABASE_URL` are `sync: false`.
6. **No credentials in URLs.** No `scheme://user:password@` anywhere in the file.
7. **Canonical addresses stay in the dashboard.** `SITE_URL`, `CLIENT_URL`, `FRONTEND_URL`, `API_URL` and `VITE_API_URL` are `sync: false`.
8. **Service shape** (*adapted*). There are two services.
   - **Backend:** `web`, `node`, `rootDir: server`, `branch: main`, `autoDeployTrigger: commit` (there is no CI), `healthCheckPath: /health`.
   - **Backend region:** a `region:` line is present, with no value asserted. The runbook's `grep FROM-DASHBOARD` gate covers the placeholder.
   - **Static site:** `static`, `rootDir: client`, `branch: main`, `autoDeployTrigger: commit`.
   - *Addition:* the `source: /sitemap.xml` and `source: /podcast.xml` lines come before `source: /*`, compared by `indexOf`.
9. **No database.** No `databases:` and no `fromDatabase` (ADR-0035).
10. **Fixed values.**
    - `NODE_ENV` is the value `production`.
    - `TRUST_PROXY` is a whole number that `parseTrustProxyHops` accepts.
    - *Addition:* both services carry `NODE_VERSION` as a fixed `major.minor.patch` value equal to the trimmed contents of `.node-version`.
    - *Adaptation:* there is no pool-size check, because the project has no pool variable.
11. *Dropped, and named in a comment in the test:* the shutdown-delay check. The app's force exit is 10 s, inside Render's 30 s default (`not verified (Render docs)`). Setting `maxShutdownDelaySeconds` would overwrite an unknown production setting.

**The templates.**

- **`server/env.example` coverage.** It lists every variable the server reads except the code-default ones, set (`NAME=`) or commented (`# NAME=`, matched only as `^#\s*[A-Z][A-Z0-9_]*=`).
- **`client/env.example` coverage.** It lists every `VITE_*` the client reads.
- **No secret values in either file.** No secret-looking name carries a value. Inline comments are stripped first, `""` counts as empty, and a plain number is not a secret.

### 4. Pin Node for both services (owner decision; mechanism planner's choice, ADR-0036)

**What Render reads.** This is from Render's docs as last read for the 2026-10-12 blueprint plan, `not verified (Render docs)`; the planner had no web access this session, and the implementer re-reads https://render.com/docs/node-version before writing.

**For native Node services, the first of these wins:**

1. the `NODE_VERSION` environment variable;
2. a `.node-version` file;
3. a `.nvmrc` file;
4. `engines.node` in `package.json`;
5. Render's default, which changes over time.

The static site's build runs on the same Node toolchain, and the docs list `NODE_VERSION` for static sites too.

**What the docs do not settle** is where the files are looked for when a service has a `rootDir`: the repository root, or the root directory. This repository has `rootDir: server` and `rootDir: client`.

**Chosen mechanism:** `NODE_VERSION` as a fixed value on both services in `render.yaml`, plus a `.node-version` at the repository root.

- **`NODE_VERSION`.** It has the highest precedence and does not depend on where a file is read from. So the `rootDir` uncertainty cannot leave either service on the default.
- **Root `.node-version`.** It is the one source of truth for local tools (fnm, nvm, Volta, asdf). The blueprint test asserts that both services' `NODE_VERSION` equals it (check 10).

**Exact `major.minor.patch`, not a major line.** A major-only pin lets Render move minor versions underneath production, which is the "unexpected change" the owner wants to avoid.

**Alternatives, rejected:**

- **`.node-version` files in `server/` and `client/`.** Three files to keep equal, and the docs still do not confirm they are read.
- **`engines.node` in both `package.json` files.** It has the lowest precedence, so a dashboard `NODE_VERSION` silently overrides it. It also changes npm's install-time warnings.
- **Only the variable.** It leaves nothing for local tools, and the test would have nothing to compare against.

**Rollout.** The blueprint is not connected, so the value in `render.yaml` does nothing yet. The owner sets `NODE_VERSION=<NODE>` by hand on both services' Environment pages, at the same time as the feedback secret. Because `<NODE>` is the version each service already runs, that redeploy changes nothing. The adoption runbook's new fixed-value comparison then finds it equal.

**Docs.**

- **`.context/deployment.md`:**
  - A short "Node version" section: the mechanism, why the variable and the file both exist, and that an upgrade changes `.node-version` and both `NODE_VERSION` values in one commit, with the test enforcing it.
  - The build-log list gains Render's Node line, so a mismatch is visible.
  - Runbook step 2's "whether `NODE_VERSION` … are set" becomes "`NODE_VERSION` must equal `.node-version`".
- **README.** The deploy section says that Node is pinned by `.node-version` and `NODE_VERSION`.

### 5. Backlog item: the backend as a Docker image behind CI

Add one entry under `## Code` in `BACKLOG.md`. It lists open work only, and the owner's reasons are kept short:

> Move the backend to a Docker image behind CI (hybrid): one pinned-base image built and smoke-tested in CI, deployed with `autoDeployTrigger: checksPass` (semantics-fun's model), so a commit is tested before it deploys and the runtime is pinned. The static site stays a Render static site: merging it into the server would take the site down with the backend, put cron/LLM/ffmpeg work beside page serving on a memory-capped instance, and lose the CDN. Costs: base-image patching becomes manual; the image needs ffmpeg and Prisma's Linux binary targets; a flaky CI blocks deploys; Render Shell operator commands in the docs need rewriting.

**The open trust-proxy item is deleted.** The backlog entry "Measure the trusted-proxy hop count … set `TRUST_PROXY` in the Render dashboard" is now done: the count was measured on 2026-10-12 and is fixed in `render.yaml` by this plan. The backlog holds only open work.

### Docs (sections 2 and 3)

**`.context/deployment.md`:**

- **The two modes, and the test.** The file names the test and states the two modes and the rule. A new variable goes into the code, `env.example` and `render.yaml` together, or into a test list.
- **"Client IPs", step 3.** `TRUST_PROXY` is fixed at `"2"` in `render.yaml`. Until the blueprint is connected, the dashboard value applies and must also be 2.
- **The `req.ip` paragraph.** It says feedback stores an HMAC under `FEEDBACK_IP_HASH_SECRET` (ADR-0037).
- **The runbook:**
  - step 3 gets the fixed-values comparison;
  - 3.3 adds the code-default-list note;
  - step 11 adds a test feedback submission.
- **Key Files** gains `blueprint.test.ts`, `lib/feedbackIpHash.ts` and `.node-version`.

**`README.md`:**

- The blueprint fixes `NODE_ENV`, `TRUST_PROXY` and `NODE_VERSION`.
- The table rows for these variables are updated, and a new row describes `FEEDBACK_IP_HASH_SECRET`: "For feedback", `openssl rand -hex 32`, and without it feedback is refused.
- The "Reverse proxy" note matches.

**ADRs.** ADR-0036 and ADR-0037 are written at implementation through `ashoka-engineering:adr`. ADR-0036 supersedes ADR-0034 and restates the parts of it that still hold.

### Landing

**Before the push**, with the owner's word, which the push needs anyway, the owner sets these in the Render dashboard:

- `FEEDBACK_IP_HASH_SECRET` on the backend; without it, feedback returns 503 from the moment the backend deploys;
- `NODE_VERSION=<NODE>` on both services;
- `TRUST_PROXY=2` on the backend.

**The commit message says:**

- these were set by hand on each service's Environment page;
- `FEEDBACK_IP_HASH_SECRET` is generated with `openssl rand -hex 32`;
- without it, production refuses feedback.

**The follow-up file's Open Items** carry the same steps as an instruction to complete before the push.

## Changes

| File | Change |
|------|--------|
| `client/src/pages/PrivacyPage.tsx` | New "Feedback Form" `<h3>` and paragraph between Newsletter and "Server Logs", owner's copy verbatim. |
| `server/src/config.ts` | `feedback.ipHashSecret: process.env.FEEDBACK_IP_HASH_SECRET \|\| ''`, with a comment pointing at ADR-0037. |
| `server/src/lib/feedbackIpHash.ts` (new) | *Responsibility:* turns a visitor's IP into the stored feedback hash under the secret, or reports that it cannot. *Exports:* `hashFeedbackIp`. Logs `error` once at load when the secret is unset. |
| `server/src/lib/feedbackIpHash.test.ts` (new) | Tests the module (below). |
| `server/src/routes/public/feedback.ts` | `createHash` is replaced by `hashFeedbackIp(ip)` after the honeypot check; `null` gives a 503 and nothing is stored. |
| `server/src/routes/public/feedback.test.ts` | Before the app import, sets `FEEDBACK_IP_HASH_SECRET` and `TRUST_PROXY = '1'` (`app.ts` loads `dotenv/config`, which never overrides a set variable). Mocks `../../lib/feedbackIpHash.js` with the actual implementation behind a `vi.fn`, so one test can return `null`. Updates the hash test. |
| `server/src/blueprint.test.ts` (new) | *Responsibility:* holds `render.yaml`, `.node-version` and both `env.example` files to the variables the code reads, and to the properties the deployment rests on. *Exports:* none. |
| `.node-version` (new, repository root) | *Responsibility:* the one Node version for local tools, which the test compares with `render.yaml`. Contents: `<NODE>`, from the owner's answer. |
| `render.yaml` | Header comment rewritten. `NODE_ENV` becomes `value: production` and `TRUST_PROXY` becomes `value: "2"`. `NODE_VERSION` with `value: "<NODE>"` goes on both services. New `FEEDBACK_IP_HASH_SECRET` entry with `sync: false`. |
| `server/env.example` | **Values removed:** secret-looking names lose their values, and the hints move to comments (`JWT_SECRET`, `OPENAI_API_KEY`, `DIFFBOT_TOKEN`, `PLUNK_SECRET_KEY`, `PLUNK_PUBLIC_KEY`, `PLUNK_FROM_EMAIL`, `MASTODON_TOKEN`, the commented `PUBLIC_API_KEY`, and `DATABASE_URL`, whose Docker template moves into a comment). **Added:** `NODE_ENV`, `CLIENT_URL`, `FORM_TOKEN_SECRET`, `PLUNK_FROM_NAME`, `EXTRACTION_API`, `LOG_LEVEL`, `TRUST_PROXY`, `FEEDBACK_IP_HASH_SECRET` (required for feedback in every environment), and any other variable outside the code-default list that the test reports missing. |
| `BACKLOG.md` | Adds the Docker-behind-CI entry (section 5). Deletes the done trust-proxy measurement entry. |
| `README.md` | As in Approach, Docs and section 4. |
| `.context/deployment.md` | As in Approach, Docs and section 4. |
| `.context/decisions/0036-….md`, `.context/decisions/0037-….md`, `.context/decisions.md` (at implementation, through `ashoka-engineering:adr`) | Promote both stubs. ADR-0034 is marked superseded by ADR-0036. |

## Tests

- **`feedbackIpHash.test.ts`:**
  - with a secret: the HMAC of `198.51.100.4`, which differs from the plain SHA-256;
  - two secrets give different hashes;
  - an empty secret gives `null`.
- **`feedback.test.ts`:**
  - the stored `ipHash` equals the HMAC for `X-Forwarded-For: 198.51.100.4`;
  - when `hashFeedbackIp` returns `null`: a 503, and `feedback.create` is not called;
  - a honeypot submission still gets 200, stores nothing and never reaches the hash;
  - the existing tests still pass.
- **`blueprint.test.ts`:** the checks in Approach. The implementer sees the key checks fail once against a scratch copy. For example:
  - remove `TRUST_PROXY`;
  - give `JWT_SECRET` a value;
  - add an unknown `envVars` line;
  - swap the route order;
  - change one service's `NODE_VERSION`.
- **`PrivacyPage.test.tsx`:** run it. There is no new test for copy, values or the backlog: static content.

## Out of Scope

- Re-hashing or deleting old `ipHash` rows.
- Feedback retention, and a "Your Rights" line for feedback.
- Rewording the Simple Analytics bullets.
- Fixing other variables before their production value is read off the dashboard.
- Connecting the blueprint, and the rest of the adoption runbook.
- Changing `TRUST_PROXY`'s code default.
- Upgrading Node: this plan pins what runs today.
- Setting `maxShutdownDelaySeconds`, CI, a YAML parser.
- The Docker move itself: backlog only.
- `.plans/open-source-preparation.md`'s extension of `server/env.example`. The test's rules accept it.
- The missing `references/client-ip.md` in the owner's `render-side-project` skill.
