/// <reference types="vite/client" />

// Version de l'application, injectee depuis package.json via `define` (vite.config.ts).
// (Les imports d'images *.png sont deja types par "vite/client".)
declare const __APP_VERSION__: string;

// Feature flag de bascule vers l'API (chantier migration, Lot 5). Absent -> mode
// localStorage (defaut, flag off). Voir AppContext + docs/migration.
interface ImportMetaEnv {
  readonly VITE_USE_API?: string;       // 'true' -> mode API
  readonly VITE_API_BASE_URL?: string;  // defaut '/api' (meme origine sur Vercel)
  readonly VITE_API_TOKEN?: string;     // ⚠️ expose dans le bundle (staging only, cf. Lot 7)
}
