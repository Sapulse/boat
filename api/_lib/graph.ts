import { HttpError } from './http.js';

// Connexion Microsoft Graph (chantier import email, Étape B — les « mains »).
// PREMIER JALON UNIQUEMENT : prouver que l'app Azure se connecte (client
// credentials) et compter les emails détectés dans la boîte. AUCUNE lecture de
// contenu, aucun pipeline — ça viendra après validation de la connexion.
//
// `fetchFn` est injectable : le harnais (scripts/harness-graph.ts) simule les
// réponses token/Graph sans réseau. En prod, fetch global (Node >= 18).

/** Les 4 variables d'environnement attendues (Vercel, scope Production). */
export interface GraphEnv {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
}

export const GRAPH_ENV_VARS = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TARGET_MAILBOX'] as const;

/** Lit et valide les 4 variables — 503 avec la liste des manquantes sinon. */
export function readGraphEnv(env: NodeJS.ProcessEnv): GraphEnv {
  const missing = GRAPH_ENV_VARS.filter(v => !env[v]?.trim());
  if (missing.length > 0) {
    throw new HttpError(503, `Connexion Microsoft 365 non configurée — variable(s) manquante(s) : ${missing.join(', ')}`);
  }
  return {
    tenantId: env.AZURE_TENANT_ID!.trim(),
    clientId: env.AZURE_CLIENT_ID!.trim(),
    clientSecret: env.AZURE_CLIENT_SECRET!.trim(),
    mailbox: env.AZURE_TARGET_MAILBOX!.trim(),
  };
}

/** Comptage par famille de source (mêmes expéditeurs que parseEmail, spec §1). */
interface SourceCount {
  label: string;
  filter: string;
  count: number | null; // null = filtre non supporté / erreur — non bloquant
  note?: string;
}

export interface GraphCheckReport {
  ok: boolean;
  mailbox: string;
  tokenAcquired: boolean;
  /** Nombre total d'emails du dossier Boîte de réception (totalItemCount). */
  inboxTotal: number | null;
  bySource: SourceCount[];
  /** Message d'aide actionnable en cas d'échec (cause la plus probable). */
  hint?: string;
}

type FetchFn = typeof fetch;

// Messages d'aide par code d'erreur Azure AD (les causes réelles les plus
// fréquentes d'une première connexion client credentials).
function tokenHint(detail: string): string {
  if (detail.includes('AADSTS7000215')) return 'Secret client invalide — vérifier AZURE_CLIENT_SECRET (coller la VALEUR du secret, pas son ID).';
  if (detail.includes('AADSTS7000222')) return 'Secret client EXPIRÉ — en générer un nouveau dans Azure (Certificats & secrets).';
  if (detail.includes('AADSTS700016')) return 'Application introuvable — vérifier AZURE_CLIENT_ID (Application/client ID de l\'app enregistrée).';
  if (detail.includes('AADSTS90002')) return 'Tenant introuvable — vérifier AZURE_TENANT_ID (Directory/tenant ID).';
  return 'Échec d\'obtention du jeton — vérifier les 3 identifiants Azure (tenant, client, secret).';
}

function graphHint(status: number, mailbox: string): string {
  if (status === 403) {
    return 'Jeton OK mais accès refusé : permission APPLICATION Mail.Read absente, consentement administrateur non accordé, '
      + 'ou ApplicationAccessPolicy qui exclut cette boîte. À voir avec le prestataire (Portail Azure > API permissions > Grant admin consent).';
  }
  if (status === 404) return `Jeton OK mais boîte « ${mailbox} » introuvable — vérifier AZURE_TARGET_MAILBOX (adresse exacte, licence Exchange active).`;
  return `Réponse inattendue de Microsoft Graph (HTTP ${status}).`;
}

/** Jeton app-only (client credentials, scope .default). */
export async function getGraphToken(env: GraphEnv, fetchFn: FetchFn = fetch): Promise<{ token: string } | { error: string }> {
  const res = await fetchFn(`https://login.microsoftonline.com/${env.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
      client_id: env.clientId,
      client_secret: env.clientSecret,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) return { error: tokenHint(text) };
  try {
    const token = (JSON.parse(text) as { access_token?: string }).access_token;
    return token ? { token } : { error: 'Réponse de jeton sans access_token.' };
  } catch {
    return { error: 'Réponse de jeton illisible.' };
  }
}

// Expéditeurs des 4 familles (spec §1) — comptage par filtre OData « advanced
// query » (en-tête ConsistencyLevel: eventual + $count=true). Sur les domaines :
// `contains` et non `endswith` — vérifié sur le tenant réel, endswith y est
// rejeté (« invalid nodes ») alors que contains passe ; l'aiguille garde le
// `@` pour ne pas matcher un sous-domaine parasite. Un filtre qui échoue rend
// un comptage null, JAMAIS un échec global.
export const SOURCE_FILTERS: { label: string; filter: string }[] = [
  { label: 'boats.com / BoatWizard', filter: "contains(from/emailAddress/address,'@leads.boats.com')" },
  { label: 'Formulaire du site', filter: "from/emailAddress/address eq 'noreply@brest-ocean-boat.fr'" },
  { label: 'Leboncoin', filter: "contains(from/emailAddress/address,'@messagerie.leboncoin.fr')" },
  { label: 'Band of Boats', filter: "from/emailAddress/address eq 'info@bandofboats.com'" },
];

/**
 * Validation de connexion : jeton -> dossier Réception (totalItemCount) ->
 * comptages par famille (best-effort). Ne lit AUCUN contenu d'email.
 */
export async function checkGraphConnection(env: GraphEnv, fetchFn: FetchFn = fetch): Promise<GraphCheckReport> {
  const report: GraphCheckReport = { ok: false, mailbox: env.mailbox, tokenAcquired: false, inboxTotal: null, bySource: [] };

  const tok = await getGraphToken(env, fetchFn);
  if ('error' in tok) { report.hint = tok.error; return report; }
  report.tokenAcquired = true;

  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.mailbox)}`;
  const auth = { Authorization: `Bearer ${tok.token}` };

  const inbox = await fetchFn(`${base}/mailFolders/inbox?$select=totalItemCount,displayName`, { headers: auth });
  if (!inbox.ok) { report.hint = graphHint(inbox.status, env.mailbox); return report; }
  const folder = await inbox.json() as { totalItemCount?: number };
  report.inboxTotal = folder.totalItemCount ?? null;
  report.ok = true;

  for (const { label, filter } of SOURCE_FILTERS) {
    try {
      // Forme « advanced query » documentée : endswith sur l'adresse expéditeur
      // exige ConsistencyLevel: eventual ET $count=true DANS la requête (le
      // segment /messages/$count ne le porte pas -> 400). On lit @odata.count
      // sur une page minimale ($top=1, $select=id) : comptage sans contenu.
      const res = await fetchFn(
        `${base}/messages?$filter=${encodeURIComponent(filter)}&$count=true&$top=1&$select=id`,
        { headers: { ...auth, ConsistencyLevel: 'eventual' } },
      );
      if (!res.ok) {
        report.bySource.push({ label, filter, count: null, note: `comptage indisponible (HTTP ${res.status})` });
        continue;
      }
      const page = await res.json() as { '@odata.count'?: number };
      const n = page['@odata.count'];
      report.bySource.push({ label, filter, count: typeof n === 'number' ? n : null, note: typeof n === 'number' ? undefined : '@odata.count absent de la réponse' });
    } catch (e) {
      report.bySource.push({ label, filter, count: null, note: `comptage indisponible (${(e as Error).message})` });
    }
  }
  return report;
}
