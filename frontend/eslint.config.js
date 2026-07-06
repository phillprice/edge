import js from '@eslint/js'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import globals from 'globals'

// eslint-plugin-react does not yet support eslint 10 — removed until a compatible
// release ships. The rules we relied on (prop-types, react-in-jsx-scope, display-name)
// were all explicitly turned off anyway.
export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooksPlugin },
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      ...reactHooksPlugin.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/set-state-in-effect': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
      eqeqeq: ['warn', 'smart'],
      // Ratchet metrics: warn for now so existing god pages don't block CI.
      // Promoted to error in the final quality-ratchet phase once pages are split.
      complexity: ['warn', 15],
      'max-lines': ['warn', { max: 600, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: ['src/**/*.test.{js,jsx}', 'src/test-setup.js', 'src/test-utils.jsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
        vi: 'readonly'
      }
    }
  }
]
