import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['out', 'dist', 'vendor', 'node_modules', 'docs', 'test-results', 'playwright-report', '.tmp'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    // The offline rule (ADR section 7): no ad hoc network access anywhere in app code.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Use the guarded session fetch in src/main/drive only.' }],
      'no-restricted-imports': ['error', { paths: ['http', 'https', 'node:https', 'axios', 'node-fetch'] }],
    },
  },
);
