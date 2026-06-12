const js = require('@eslint/js')
const globals = require('globals')

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.es2021 },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Empty catch is the established silent-migration idiom in db/schema.js;
      // replaced by versioned migrations in the db-migrations phase.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
      'no-var': 'error',
      eqeqeq: ['warn', 'smart'],
      // Ratchet metrics: warn for now so existing god files don't block CI.
      // Promoted to error in the final quality-ratchet phase once files are split.
      complexity: ['warn', 15],
      'max-lines': ['warn', { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['**/*.test.js', 'scripts/jest-teardown.js'],
    languageOptions: {
      globals: { ...globals.jest },
    },
  },
  {
    ignores: ['node_modules/', 'coverage/', '*.db', '*.db-*', 'uploads/'],
  },
]
