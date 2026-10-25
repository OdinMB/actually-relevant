import '@testing-library/jest-dom'
import { expect } from 'vitest'
import * as matchers from 'vitest-axe/matchers'
import type { AxeMatchers } from 'vitest-axe'

expect.extend(matchers)

declare module 'vitest' {
  // Declaration merging adds the axe matchers; the interfaces must keep vitest's names and parameter
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
  interface Assertion<T> extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
