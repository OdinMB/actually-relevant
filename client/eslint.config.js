// ESLint flat config for the client (.context/ci.md, "Lint").
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'boiler/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: { globals: globals.browser },
    rules: {
      // `_`-prefixed names are deliberate: unused parameters, and keys dropped by a rest spread
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
      // Off: React Compiler rules from react-hooks 7 that would need effect rewrites (.context/ci.md).
      // set-state-in-effect: 9 effects sync state from storage, the URL or loaded data on mount;
      // moving each into an initializer or a key is a behavior change to test one by one.
      'react-hooks/set-state-in-effect': 'off',
      // static-components: getCategoryPattern() returns a module-level component from a map,
      // which the rule cannot see is stable (3 findings, none a real remount).
      'react-hooks/static-components': 'off',
      // The client's TS lib is ES2020, which has no `new Error(msg, { cause })`
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['scripts/**', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
    rules: { 'preserve-caught-error': 'error' },
  },
  {
    // Mocks and fixtures stand in for typed collaborators; `any` there is the cheap, honest cast
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
)
