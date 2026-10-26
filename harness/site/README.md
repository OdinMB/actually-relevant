# Site harness

Development tooling, never deployed and never run by CI. One foreground command that shows the public website (`client/`) the way a reader sees it, on a phone and on a desktop, with invented data, and reaches nothing outside the machine.

It serves the client with Vite in development mode from the client's own `vite.config.ts`, answers its `/api` calls from an invented fixture API, and drives headless Chrome through Puppeteer, saving a screenshot, the page text and the accessibility tree after every step.

## Run it

```bash
node harness/site/run.mjs --out <folder> [parameters]
```

From any folder: paths resolve from the harness's own location, so a worktree runs its own copy. Example:

```bash
node harness/site/run.mjs --out /tmp/site-run --chrome /path/to/chrome --route / --route /newsletter --viewport phone
```

It needs:

- **Node from `.node-version`.** The run imports the server's TypeScript copy module (type stripping) and relies on `NODE_USE_ENV_PROXY`; the launcher refuses a Node that lacks either.
- **The client's dependencies:** `npm ci --prefix client --ignore-scripts`. The harness adds no dependency of its own: Vite, Puppeteer and TypeScript come from `client/node_modules`, and `package.json` here holds metadata and the test script only.
- **A Chrome or Chromium binary,** given with `--chrome`. Without it the launcher uses the browser Puppeteer downloaded for the client, if there is one; with install scripts skipped there is none.

## Parameters

| Parameter                         | What it varies                                                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--out <folder>`                  | Required. Every output goes under it. Must be outside the repository and outside the checkout a worktree sits in; new, empty, or an earlier output folder of this harness (marked by `.site-harness-out`), whose outputs a new run clears.  |
| `--route <path>`                  | A page to visit and capture, such as `/newsletter` or `/stories/<slug>`. Repeatable, in order. Default `/`, unless a steps file is given. Paths only: a URL to another host is refused.                                                     |
| `--viewport <v>`                  | `phone` (390x844, scale 2, touch), `desktop` (1440x900) or `<width>x<height>` (mobile below 768 wide). Repeatable; each gets a fresh browser context. Default: phone and desktop.                                                           |
| `--steps <file>`                  | A JSON steps file (below), run after the routes on each viewport.                                                                                                                                                                           |
| `--chrome <path>`                 | The Chrome or Chromium executable to drive.                                                                                                                                                                                                 |
| `--fail <path>=<status>[:<CODE>]` | Makes the fixture API answer a path with that status (400 to 599) and `{ "error": "Fixture failure (<status>)", "code": "<CODE>" }`. `<status>` may be `drop`: the connection is cut. A path ending in `*` matches as a prefix. Repeatable. |
| `--delay <path>=<ms>`             | Delays the fixture API's answer for a path, up to 60000 ms. Same path rules. Repeatable.                                                                                                                                                    |
| `--timeout <s>`                   | Stops the whole run after this many seconds (1 to 3600, default 300).                                                                                                                                                                       |
| `--step-timeout <s>`              | Per step and page load (1 to 3600, default 30). The first page of each viewport may take up to 120 s while Vite prepares the client's dependencies.                                                                                         |
| `--viewport-only`                 | Screenshots of the viewport instead of the full page.                                                                                                                                                                                       |
| `--guard-test=<case>`             | A negative test of the guard (below): `env`, `target`, `target-loopback` or `network`.                                                                                                                                                      |
| `--list-routes`                   | Prints the pages the invented data fills (the static pages in `shared/routes.json`, then each child issue, story, newsletter issue and episode transcript) and exits. Starts nothing.                                                       |
| `--help`                          | Prints the parameters. Starts nothing.                                                                                                                                                                                                      |

`--fail` examples: `--fail /api/subscribe/token=503:SIGNUPS_PAUSED` (the paused signup form), `--fail /api/homepage=500`, `--fail '/api/stories/*=drop'`, `--delay /api/podcast=3000` (the loading state).

### Steps file

A JSON array of steps, or `{ "steps": [...] }`. Each step does one thing; `name` labels its files, and `capture: false` skips its screenshot, text and accessibility tree.

| Step                                                     | Does                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `{ "goto": "/podcast" }`                                 | Opens a page of the local site.                                              |
| `{ "click": "<selector>" }`                              | Clicks the element.                                                          |
| `{ "hover": "<selector>" }`                              | Hovers over it.                                                              |
| `{ "type": "<text>", "into": "<selector>" }`             | Fills a field.                                                               |
| `{ "press": "Enter" }`                                   | Presses a key (Puppeteer's key names).                                       |
| `{ "wait": 500 }` or `{ "wait": "<selector>" }`          | Waits that many milliseconds (up to 60000), or until the element appears.    |
| `{ "scroll": "top" \| "bottom" \| 600 \| "<selector>" }` | Scrolls to the top or bottom, by that many pixels, or the element into view. |

Selectors are CSS or Puppeteer's own, such as `::-p-text(Subscribe)` and `::-p-aria(Email address)`. After each step the run waits until the page has made no request for half a second, no page chunk is loading (the client's `data-route-fallback` marker) and fonts are ready. A viewport stops at its first failing step, after capturing the page as that step left it.

```json
[
  { "goto": "/newsletter" },
  { "type": "reader@example.com", "into": "input[type=email]", "capture": false },
  { "click": "::-p-text(Subscribe)", "name": "after signup" },
  { "wait": "[role=status]" }
]
```

## What it serves

- **The site** on `127.0.0.1` at a port the OS picks, through Vite in middleware mode behind the harness's own listener: the client's config with no env files (`envDir: false`), no prerender plugin, the dev proxy's `/api` pointed at the fixture API instead of `localhost:3001`, HMR on the site's own port, no file watching, and Vite's caches under `<out>/.cache` and `<out>/.runtime`.
- **The fixture API** on `127.0.0.1` at another port the OS picks, as `VITE_API_URL`. It answers the routes the public pages call, with the server's status codes and error bodies: `/api/homepage`, `/api/stories` (page, page size, issue, emotion and search filters), `/api/stories/<slug>`, `/related` and `/cluster`, `/api/issues` and `/api/issues/<slug>`, `/api/sources`, `/api/newsletters` and `/api/newsletters/<slug>`, `/api/podcast` and `/api/podcast/episodes/<id>`, the RSS feeds, `/api/docs/openapi.json` (a minimal invented spec), and the signup, confirmation and feedback forms with their form-token endpoints and honeypot. It stores nothing, logs no request body, and answers anything else 404 (listed as unanswered in `api-requests.json`). Episode audio is a short silent WAV it serves itself.
- **The data** in `lib/fixtures.mjs`: invented stories, publishers, newsletter issues and episodes, no real person anywhere. Dates are relative to the run's start. The AI label wording comes from the server's copy module, not a copy of it. `test/fixtures-types.test.mjs` type-checks the fixtures against `shared/types` and the client's API types, so a renamed or retyped field fails a test.

Turnstile is off (`VITE_TURNSTILE_SITE_KEY` empty), and the analytics script in `index.html` is blocked on every page and listed in `blocked-requests.json`.

## Outputs

Everything goes under `--out`:

| Path                              | Holds                                                                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<viewport>/NN-<label>.png`       | The screenshot after step NN (full page unless `--viewport-only`).                                                                                                               |
| `<viewport>/NN-<label>.txt`       | The page's visible text.                                                                                                                                                         |
| `<viewport>/NN-<label>.a11y.json` | Its accessibility tree (Puppeteer's snapshot, interesting nodes only).                                                                                                           |
| `report.json`                     | Parameters, ports, the guard's outcome, each viewport's steps (path, title, status, notes, error, files), whether `navigator.webdriver` was false, counts, exit code and reason. |
| `console.json`                    | Console errors and warnings, uncaught page errors, and failed requests to the run's own ports, by viewport and step.                                                             |
| `blocked-requests.json`           | Every request the browser blocked, popups included, by viewport and step.                                                                                                        |
| `api-requests.json`               | Every fixture API request: method, path, status, whether a route answered it, whether `--fail` did.                                                                              |
| `proxy-sink.json`                 | How many connections the proxy sink dropped.                                                                                                                                     |
| `.cache/`                         | Vite's dependency cache, kept so the next run starts faster.                                                                                                                     |

`.runtime/` (temporary home, config, cache and temp folders, the browser profile) exists only while the run does.

## The guard

The harness enforces its own hermeticity at run time and fails closed. The launcher (`lib/launcher.mjs`) checks the parameters, holds the proxy sink, and starts the run (`lib/child.mjs`, `lib/run-child.mjs`) as a child process with a **cleared environment** built by `buildChildEnv` in `lib/guard.mjs`: `PATH` (and `SYSTEMROOT`, `COMSPEC`, `WINDIR`, `PATHEXT` on Windows) copied from the caller; `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, the `XDG_*` folders and the temp folders under `<out>/.runtime`; the proxy variables; and the fixture values (`VITE_TURNSTILE_SITE_KEY` empty, `NODE_ENV=development`, `SITE_HARNESS_CHILD=1`, and `VITE_API_URL` once the fixture API listens). Nothing else of the caller's environment reaches the run. Vite reads no env files, and no dotenv loader is involved. The run's working folder is `client/`, as for `vite dev`, because Tailwind finds its config and content globs from there; nothing the run writes is relative to it.

**Assertions,** in `lib/guard.mjs`, printing names and never values. Any failure prints `hermetic-guard: refused: <problems>` and exits 2 before the site answers a request or a browser starts:

- the Node running the product can strip types and honors `NODE_USE_ENV_PROXY`;
- the environment holds only the allowlist and the fixture names, the temp folders are under the output folder, the proxy variables point at the sink, and every fixture name is unset or holds its fixture value. Checked once before the client's config loads, and again after, so a variable the config code adds is caught;
- every variable `client/env.example` names is unset or holds its fixture value;
- every outward target the client resolves is one the run started: `import.meta.env.VITE_API_URL` is the fixture API, the dev proxy targets only the run's ports, HMR rides on the site's port, Vite opens no listener of its own and binds `127.0.0.1`; Vite reads no env files and `import.meta.env` holds nothing but the fixtures; the prerender plugin is gone. Checked on the resolved config before the Vite server exists, and again on the server's own config;
- Turnstile is off, and every outside script or stylesheet `index.html` loads (the analytics script) is one the browser blocks.

**Network.** `HTTP_PROXY` and `HTTPS_PROXY` point at the proxy sink, a loopback port the launcher holds for the whole run that drops every connection, with `NO_PROXY=127.0.0.1,localhost` and `NODE_USE_ENV_PROXY=1`, so Node's own fetch cannot leave the machine. The browser blocks every request not to the site's or the fixture API's port (request interception, reported in `blocked-requests.json`), sends anything else to the sink (`--proxy-server`, with `<-loopback>` so another local port goes there too), and resolves no host name. Popups are closed and reported.

**Listen and clean up.** Both servers listen on `127.0.0.1` at ports the OS picks; the browser talks over a pipe, opening no DevTools port. The run stops everything it started on its own exit, on `--timeout` and on a signal. The launcher stops the run and everything under it by force (its process group on POSIX, its process tree on Windows) 30 s after `--timeout` or 15 s after a signal; once the run has exited it kills whatever is left in its process group (POSIX), closes the sink, and removes `.runtime`. Output goes only under `--out`. If the launcher itself is killed, the run still stops at its own `--timeout`.

**Report.** Once every assertion passes, the run prints exactly one line `hermetic-guard: ok port <n>`, where `<n>` is the site's port, and then a line naming the fixture API's and the sink's ports. After the run each of them is free again.

### Negative tests

Each case is planted inside the run, after the environment was cleared, and must make the run exit non-zero. A negative test passes when the run exits 2 and prints `hermetic-guard: refused: …`; one that exits 0 means the guard let the case through.

| Invocation                                                                              | Plants                                                                                     | Refused because                                                                                                                          |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `node harness/site/run.mjs --out <folder> --chrome <path> --guard-test=env`             | `SITE_HARNESS_GUARD_TEST_STRAY`, as a dotenv file would add one                            | the environment holds a variable on no allowlist                                                                                         |
| `node harness/site/run.mjs --out <folder> --chrome <path> --guard-test=target`          | `VITE_API_URL=https://guard-test.invalid`, where the client reads its API base URL         | `VITE_API_URL` holds something other than its fixture value, the fixture API's origin                                                    |
| `node harness/site/run.mjs --out <folder> --chrome <path> --guard-test=target-loopback` | `VITE_API_URL=http://127.0.0.1:9`, a loopback port the run did not start                   | the same                                                                                                                                 |
| `node harness/site/run.mjs --out <folder> --chrome <path> --guard-test=network`         | after the guard line, one GET to `https://example.com/` from the browser and one from Node | both must fail; the run then exits 2 and names how each failed, or exits 0 with `hermetic-guard: NOT refused: …` if either got an answer |

## Exit codes

| Code | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| 0    | The run finished; every step ran.                                             |
| 1    | A step failed (see `report.json`), or the run hit an error.                   |
| 2    | The guard refused the run (`hermetic-guard: refused: …`).                     |
| 64   | A parameter, the Node version or the browser path was wrong; nothing started. |
| 124  | `--timeout` passed; everything was stopped.                                   |
| 130  | A signal stopped the run.                                                     |

## Tests

```bash
node --test harness/site/test/*.test.mjs
```

They show the guard refusing each negative-test case and accepting a clean environment, the run's order of events (with stand-ins: the guard line comes before the site serves; a refused case loads no config, serves nothing and starts no browser), the client's real `vite.config.ts` resolved under the overrides and refused once a target is planted, Node's fetch in the run's environment reaching only the sink, the fixture API's answers, and the parameters and steps. They never start the Vite server or a browser.

## Limits

- The development build, not the production one: no prerendered HTML, React's development mode, and the client's development-only accessibility logging in the console.
- Link previews (`og.png`), RSS readers, the admin pages and anything behind a login are out of scope; `/api/auth/refresh` answers 401.
- Links to other sites cannot be followed: the requests are blocked and reported.
- Chrome runs with `--no-sandbox`, as the client's prerender launches it; it only ever loads the local site.
