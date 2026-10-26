import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { harnessDir, importFromClient } from '../lib/paths.mjs'

test('the fixtures type-check against the shared types and the client API types', async () => {
  const ts = (await importFromClient('typescript')).default
  const configPath = path.join(harnessDir, 'tsconfig.json')
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile)
  assert.equal(error, undefined)
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, harnessDir)
  assert.deepEqual(parsed.errors, [])
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  const text = ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: name => name,
    getCurrentDirectory: () => harnessDir,
    getNewLine: () => '\n',
  })
  assert.equal(diagnostics.length, 0, text)
})
