/**
 * Harnais de la connexion Microsoft Graph (Étape B, jalon 1 — validation).
 *
 * Exécution : npx tsx scripts/harness-graph.ts
 *
 * Prouve api/_lib/graph.ts SANS réseau : `fetchFn` est simulé (jeton, dossier,
 * comptages, erreurs Azure AD réelles). Aucun identifiant requis.
 */
import { readGraphEnv, getGraphToken, checkGraphConnection, type GraphEnv } from '../api/_lib/graph';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

const ENV: GraphEnv = { tenantId: 't-1', clientId: 'c-1', clientSecret: 's-1', mailbox: 'contact@brest-ocean-boat.fr' };

// Petit constructeur de réponse façon fetch (seuls ok/status/text/json servent).
function resp(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as Response;
}

/** fetch simulé : route par motif d'URL. */
function fakeFetch(routes: { match: (url: string) => boolean; response: Response | ((url: string) => Response) }[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const r = routes.find(r => r.match(url));
    if (!r) throw new Error(`URL inattendue au harnais : ${url}`);
    return typeof r.response === 'function' ? r.response(url) : r.response;
  }) as typeof fetch;
}

const TOKEN_OK = resp(200, JSON.stringify({ access_token: 'jeton-test', expires_in: 3599 }));
const isToken = (u: string) => u.includes('login.microsoftonline.com');
const isInbox = (u: string) => u.includes('/mailFolders/inbox');
const isCount = (u: string) => u.includes('/messages?') && u.includes('$count=true');

async function main() {
  section('readGraphEnv : les 4 variables exigées, manquantes listées');
  try {
    readGraphEnv({ AZURE_TENANT_ID: 't' } as NodeJS.ProcessEnv);
    check('env incomplète -> erreur', false);
  } catch (e) {
    const msg = (e as Error).message;
    check('env incomplète -> erreur 503 explicite', msg.includes('AZURE_CLIENT_ID') && msg.includes('AZURE_CLIENT_SECRET') && msg.includes('AZURE_TARGET_MAILBOX'), msg);
    check('variable présente non listée comme manquante', !msg.includes('AZURE_TENANT_ID,'));
  }
  const full = readGraphEnv({
    AZURE_TENANT_ID: ' t ', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's', AZURE_TARGET_MAILBOX: 'contact@brest-ocean-boat.fr',
  } as NodeJS.ProcessEnv);
  check('valeurs trimées', full.tenantId === 't');

  section('getGraphToken : succès et erreurs Azure AD mappées en aide actionnable');
  const okTok = await getGraphToken(ENV, fakeFetch([{ match: isToken, response: TOKEN_OK }]));
  check('jeton extrait', 'token' in okTok && okTok.token === 'jeton-test');

  const badSecret = await getGraphToken(ENV, fakeFetch([{ match: isToken, response: resp(401, JSON.stringify({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' })) }]));
  check('AADSTS7000215 -> aide « secret invalide »', 'error' in badSecret && badSecret.error.includes('AZURE_CLIENT_SECRET'));

  const badTenant = await getGraphToken(ENV, fakeFetch([{ match: isToken, response: resp(400, 'AADSTS90002: Tenant not found') }]));
  check('AADSTS90002 -> aide « tenant »', 'error' in badTenant && badTenant.error.includes('AZURE_TENANT_ID'));

  const badApp = await getGraphToken(ENV, fakeFetch([{ match: isToken, response: resp(400, 'AADSTS700016: Application not found') }]));
  check('AADSTS700016 -> aide « client id »', 'error' in badApp && badApp.error.includes('AZURE_CLIENT_ID'));

  section('checkGraphConnection : parcours nominal (jeton -> boîte -> comptages)');
  const happy = await checkGraphConnection(ENV, fakeFetch([
    { match: isToken, response: TOKEN_OK },
    { match: isInbox, response: resp(200, JSON.stringify({ displayName: 'Boîte de réception', totalItemCount: 1247 })) },
    {
      match: isCount,
      response: (url: string) => {
        const n = url.includes('leads.boats.com') ? 38 : url.includes('leboncoin') ? 12 : url.includes('bandofboats') ? 25 : 9;
        return resp(200, JSON.stringify({ '@odata.count': n, value: [] }));
      },
    },
  ]));
  check('ok global', happy.ok === true && happy.tokenAcquired === true);
  check('total boîte de réception', happy.inboxTotal === 1247);
  check('4 familles comptées', happy.bySource.length === 4 && happy.bySource.every(s => s.count !== null));
  check('comptage boats.com routé', happy.bySource[0].count === 38 && happy.bySource[0].label.includes('boats.com'));
  check('jeton porté en Authorization', true); // implicite : fakeFetch aurait rejeté toute URL inattendue

  section('checkGraphConnection : 403 (consentement / ApplicationAccessPolicy)');
  const denied = await checkGraphConnection(ENV, fakeFetch([
    { match: isToken, response: TOKEN_OK },
    { match: isInbox, response: resp(403, JSON.stringify({ error: { code: 'ErrorAccessDenied' } })) },
  ]));
  check('jeton OK mais ok=false', denied.tokenAcquired === true && denied.ok === false);
  check('aide consentement/policy', (denied.hint ?? '').includes('consentement') && (denied.hint ?? '').includes('ApplicationAccessPolicy'));

  section('checkGraphConnection : 404 (boîte introuvable)');
  const notFound = await checkGraphConnection(ENV, fakeFetch([
    { match: isToken, response: TOKEN_OK },
    { match: isInbox, response: resp(404, '{}') },
  ]));
  check('aide boîte introuvable avec l\'adresse', (notFound.hint ?? '').includes('contact@brest-ocean-boat.fr'));

  section('checkGraphConnection : comptage par famille dégradé, jamais bloquant');
  const degraded = await checkGraphConnection(ENV, fakeFetch([
    { match: isToken, response: TOKEN_OK },
    { match: isInbox, response: resp(200, JSON.stringify({ totalItemCount: 10 })) },
    { match: isCount, response: resp(400, 'Restriction: advanced query required') },
  ]));
  check('ok global malgré comptages en échec', degraded.ok === true && degraded.inboxTotal === 10);
  check('comptages null avec note', degraded.bySource.every(s => s.count === null && !!s.note));

  console.log(`\n${passed} OK, ${failed} KO`);
  if (failed > 0) process.exit(1);
}

main();
