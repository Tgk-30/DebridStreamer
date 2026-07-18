import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
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
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      // The shared UI primitives intentionally export variants next to their
      // components, matching the upstream shadcn structure.
      'react-refresh/only-export-components': 'off',
      'react-hooks/purity': 'off',
    },
  },
  {
    files: ['src/components/three/ProviderConstellation.tsx'],
    rules: {
      // Three.js frame state lives in mutable refs by design so animation does
      // not schedule a React render for every frame.
      'react-hooks/immutability': 'off',
    },
  },
  {
    files: [
      'src/pages/features/ChapterNav.tsx',
      'src/pages/features/shared.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: [
      'src/pages/features/ContinueDemo.tsx',
      'src/pages/features/SeriesDemo.tsx',
      'src/pages/features/hooks.ts',
    ],
    rules: {
      // These demo effects intentionally reset animation state when they enter
      // the viewport or the reduced-motion preference changes.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
