// First step of `npm run build` in client/ and server/: install the package's
// devDependencies even where the environment omits them (NODE_ENV=production).
// TypeScript, its type packages, Vite and the prerenderer are devDependencies,
// so without this the build fails or runs whatever `tsc` is on PATH. Installs
// into the working directory, which npm sets to the package running the
// script. See .context/deployment.md.
import { spawnSync } from 'node:child_process'

// `npm run build --prefix client` exports npm_config_prefix=<client dir> to
// the script. A nested npm takes that as its global prefix too, and on Windows
// a bare `npm install` whose global and local prefix match turns into
// `npm install .`, adding the package to its own dependencies. Drop the
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
