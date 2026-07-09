import { defineConfig, loadEnv } from 'vite'
import { createRequire } from 'node:module'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Source unique de la version : package.json. Injectee a la compilation comme
// constante __APP_VERSION__ (seule la chaine finit dans le bundle).
const pkg = createRequire(import.meta.url)('./package.json') as { version: string }

export default defineConfig(({ command, mode }) => {
  // PROXY DE DEV UNIQUEMENT (jamais dans le build de prod). Sert à tester le
  // flag on (VITE_USE_API=true) en local sans CORS : les appels /api/* de l'app
  // sont relayés CÔTÉ SERVEUR Vite vers l'API Vercel, donc le navigateur ne voit
  // qu'une seule origine (localhost) — ça reproduit le « même origine » de la
  // prod. Activé SEULEMENT si `DEV_API_PROXY_TARGET` est défini (dans .env.local,
  // non commité) ET en mode `serve` : le build (`command === 'build'`) n'en
  // reçoit jamais rien. Var sans préfixe VITE_ -> lue par la config seule, JAMAIS
  // exposée au bundle client.
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.DEV_API_PROXY_TARGET
  const devProxy =
    command === 'serve' && proxyTarget
      ? {
          server: {
            proxy: {
              '/api': { target: proxyTarget, changeOrigin: true, secure: true },
            },
          },
        }
      : {}

  return {
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
    ...devProxy,
  }
})
