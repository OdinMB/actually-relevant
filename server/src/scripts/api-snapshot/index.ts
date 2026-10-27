/**
 * Refreshes the committed contract of the public API (src/lib/openapi.snapshot.json) from the
 * OpenAPI document the code generates, after printing what changed (.context/ci.md, "Public API
 * contract"):
 *
 *   npm run api:snapshot --prefix server                        # changes that break no client
 *   npm run api:snapshot --prefix server -- --accept-breaking   # a breaking change, on purpose
 *
 * Without --accept-breaking a breaking change is refused: nothing is written and the exit code is 1.
 * It reads no environment file and no database: the contract leaves out the server URL and wording.
 */
import { getOpenAPIDocument } from '../../lib/openapi.js'
import { API_SNAPSHOT_PATH, apiContract } from '../../lib/openapiContract.js'
import { refreshApiSnapshot } from './refresh.js'

const written = await refreshApiSnapshot({
  path: API_SNAPSHOT_PATH,
  current: apiContract(getOpenAPIDocument()),
  acceptBreaking: process.argv.slice(2).includes('--accept-breaking'),
})
if (!written) process.exitCode = 1
