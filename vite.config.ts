import { defineConfig } from 'vite'
import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Source unique de la version : package.json. Injectee a la compilation comme
// constante __APP_VERSION__ (seule la chaine finit dans le bundle).
const pkg = createRequire(import.meta.url)('./package.json') as { version: string }

export default defineConfig({
  // Base path conditionnel selon la cible de build (chantier migration, Lot 4) :
  //  - sur Vercel (var système VERCEL=1) l'app est servie à la RACINE -> base '/'.
  //  - ailleurs (GitHub Actions/Pages, local) -> '/boat/' (sapulse.github.io/boat/).
  // Les deux cibles restent correctes EN MÊME TEMPS : Pages ne casse pas pendant
  // qu'on valide Vercel. À simplifier en '/' quand Pages sera abandonné (Lot 6).
  base: process.env.VERCEL ? '/' : '/boat/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
})
