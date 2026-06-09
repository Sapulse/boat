import { defineConfig } from 'vite'
import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Source unique de la version : package.json. Injectee a la compilation comme
// constante __APP_VERSION__ (seule la chaine finit dans le bundle).
const pkg = createRequire(import.meta.url)('./package.json') as { version: string }

export default defineConfig({
  base: '/boat/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
})
