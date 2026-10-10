import js from '@eslint/js';
import globals from 'globals';

const testGlobals = {
  describe: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
  vi: 'readonly'
};

export default [
  {
    ignores: ['node_modules/**', 'library/scores/**', 'samples/**']
  },
  {
    files: ['*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        DecompressionStream: 'readonly'
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...testGlobals
      }
    },
    rules: {
      ...js.configs.recommended.rules
    }
  }
];
