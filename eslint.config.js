import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // 'dist' = build Vite. 'prisma.config.ts' = outillage DB hors app (chantier
  // migration, Lot 1) : ne doit pas entrer dans le lint de l'app.
  // '_import_local' = données RGPD locales + scripts jetables d'import (gitignoré,
  // hors codebase) : jamais linté.
  globalIgnores(['dist', 'prisma.config.ts', '_import_local']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
