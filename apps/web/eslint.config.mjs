import js from '@eslint/js'
import ts from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist/**', 'plugin-dist/**', 'public/plugin-platform/**', '.next/**', '.next-desktop/**']),
  { files: ['src/**/*.{ts,tsx}', '*.ts'], extends: [js.configs.recommended, ts.configs.recommended, hooks.configs.flat.recommended],
    rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
])
