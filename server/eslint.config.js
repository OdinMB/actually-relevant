// ESLint flat config for the server (.context/ci.md, "Lint").
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'logs/', 'node_modules/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      // `_`-prefixed names are deliberate: unused parameters, and keys dropped by a rest spread
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
      // Regexes that match no-break spaces and a BOM spell those characters out
      'no-irregular-whitespace': ['error', { skipRegExps: true }],
      // `declare global { namespace Express { … } }` is how Express's Request is augmented
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  },
  {
    // Mocks and fixtures stand in for typed collaborators; `any` there is the cheap, honest cast
    files: ['src/**/*.test.ts', 'src/test/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
)
