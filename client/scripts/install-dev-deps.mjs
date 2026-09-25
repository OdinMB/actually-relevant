// First step of `npm run build`: install devDependencies even where the
// environment omits them (NODE_ENV=production). TypeScript, Vite and the
// prerenderer are devDependencies, so without this the build would fail or
// run whatever `tsc` is on PATH. See .context/deployment.md.
import { spawnSync } from 'node:child_process'

// `npm run build --prefix client` exports npm_config_prefix=<client dir> to
// the script. A nested npm takes that as its global prefix too, and on Windows
// a bare `npm install` whose global and local prefix match turns into
// `npm install .`, adding the client to its own dependencies. Drop the
// variable so the install finds the project from the working directory alone.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_config_prefix'),
)

const args = ['install', '--include=dev', '--no-audit', '--no-fund']
// Under `npm run`, npm_execpath is the running npm's CLI script: reuse it so the
// install uses the same npm. Otherwise (run directly with node) go via the shell.
const npmCli = process.env.npm_execpath
const result = npmCli && /npm-cli\.[cm]?js$/.test(npmCli)
  ? spawnSync(process.execPath, [npmCli, ...args], { stdio: 'inherit', env })
  : spawnSync(`npm ${args.join(' ')}`, { stdio: 'inherit', env, shell: true })

if (result.error) throw result.error
process.exit(result.status ?? 1)
