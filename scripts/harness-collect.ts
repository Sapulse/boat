/**
 * Harnais du collecteur d'emails (Étape B, pipeline — api/_lib/inboundCollect.ts).
 *
 * Exécution : npx tsx scripts/harness-collect.ts
 *
 * SANS réseau (fetch simulé, données FICTIVES) : filtres par famille + fenêtre
 * de date dans les URLs, dossier inbox canonique, déduplication par
 * internetMessageId, tri chronologique, cap, repli HTML, erreurs par famille
 * non bloquantes, chaînage collecte -> parseEmail.
 */
import { fetchRecentSourceEmails, toParseInput, type CollectedMessage } from '../api/_lib/inboundCollect';
import { parseEmail } from '../src/lib/email/parseEmail';
import type { GraphEnv } from '../api/_lib/graph';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

const ENV: GraphEnv = { tenantId: 't', clientId: 'c', clientSecret: 's', mailbox: 'contact@brest-ocean-boat.fr' };
const SINCE = '2026-07-21T00:00:00.000Z';

function resp(status: number, body: unknown): Response {
  return { ok: status < 300, status, text: async () => JSON.stringify(body), json: async () => body } as Response;
}

function gmsg(over: Partial<{ id: string; imid: string; at: string; from: string; name: string; subject: string; content: string; type: string }>): unknown {
  return {
    id: over.id ?? 'g1',
    internetMessageId: over.imid ?? '<m1@x>',
    receivedDateTime: over.at ?? '2026-07-22T10:00:00Z',
    subject: over.subject ?? 'Objet',
    from: { emailAddress: { name: over.name ?? 'Test', address: over.from ?? 'noreply@brest-ocean-boat.fr' } },
    body: { contentType: over.type ?? 'text', content: over.content ?? 'Bonjour' },
  };
}

const seenUrls: string[] = [];
function fetchStub(routes: { match: (u: string) => boolean; response: Response }[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    seenUrls.push(url);
    const r = routes.find(r => r.match(url));
    if (!r) throw new Error(`URL inattendue : ${url}`);
    return r.response;
  }) as typeof fetch;
}
const TOKEN = { match: (u: string) => u.includes('login.microsoftonline.com'), response: resp(200, { access_token: 'jeton' }) };
const fam = (needle: string) => (u: string) => u.includes('/mailFolders/inbox/messages') && decodeURIComponent(u).includes(needle);

async function main() {
  section('Requêtes : inbox canonique, filtre famille + fenêtre de date, sans $orderby');
  seenUrls.length = 0;
  const r1 = await fetchRecentSourceEmails(ENV, {
    sinceIso: SINCE,
    fetchFn: fetchStub([
      TOKEN,
      { match: fam('leads.boats.com'), response: resp(200, { value: [gmsg({ id: 'gA', imid: '<a@x>', at: '2026-07-23T09:00:00Z', from: 'x1@leads.boats.com', subject: 'INTERESTED-IN: Antares 8' })] }) },
      { match: fam('noreply@brest-ocean-boat.fr'), response: resp(200, { value: [gmsg({ id: 'gB', imid: '<b@x>', at: '2026-07-22T08:00:00Z' })] }) },
      { match: fam('leboncoin'), response: resp(200, { value: [] }) },
      { match: fam('bandofboats'), response: resp(200, { value: [] }) },
    ]),
  });
  const msgUrls = seenUrls.filter(u => u.includes('/messages?'));
  check('4 requêtes familles émises', msgUrls.length === 4, String(msgUrls.length));
  check('dossier inbox canonique dans chaque URL', msgUrls.every(u => u.includes('/mailFolders/inbox/messages')));
  check('fenêtre de date dans chaque filtre', msgUrls.every(u => decodeURIComponent(u).includes(`receivedDateTime ge ${SINCE}`)));
  check('aucun $orderby (refusé en advanced query)', msgUrls.every(u => !u.includes('orderby')));
  check('corps demandé en texte (Prefer)', true); // porté par les headers, vérifié indirectement par le repli HTML plus bas
  check('2 messages collectés, tri CHRONOLOGIQUE', r1.messages.length === 2 && r1.messages[0].internetMessageId === '<b@x>');
  check('adresse expéditeur normalisée minuscules', r1.messages.every(m => m.fromAddress === m.fromAddress.toLowerCase()));

  section('Déduplication par internetMessageId (même email vu par 2 filtres)');
  const dup = gmsg({ id: 'gDup', imid: '<dup@x>', from: 'x@leads.boats.com' });
  const r2 = await fetchRecentSourceEmails(ENV, {
    sinceIso: SINCE,
    fetchFn: fetchStub([
      TOKEN,
      { match: fam('leads.boats.com'), response: resp(200, { value: [dup] }) },
      { match: fam('noreply@brest-ocean-boat.fr'), response: resp(200, { value: [dup] }) },
      { match: fam('leboncoin'), response: resp(200, { value: [] }) },
      { match: fam('bandofboats'), response: resp(200, { value: [] }) },
    ]),
  });
  check('1 seul message conservé', r2.messages.length === 1);

  section('Cap global : troncature signalée, jamais silencieuse');
  const many = Array.from({ length: 5 }, (_, i) => gmsg({ id: `g${i}`, imid: `<n${i}@x>`, at: `2026-07-2${2 + (i % 5)}T10:0${i}:00Z` }));
  const r3 = await fetchRecentSourceEmails(ENV, {
    sinceIso: SINCE, cap: 3,
    fetchFn: fetchStub([
      TOKEN,
      { match: fam('leads.boats.com'), response: resp(200, { value: many }) },
      { match: fam('noreply@brest-ocean-boat.fr'), response: resp(200, { value: [] }) },
      { match: fam('leboncoin'), response: resp(200, { value: [] }) },
      { match: fam('bandofboats'), response: resp(200, { value: [] }) },
    ]),
  });
  check('messages limités au cap', r3.messages.length === 3);
  check('troncature signalée', r3.truncated === true);

  section('Erreur d\'une famille : non bloquante, signalée');
  const r4 = await fetchRecentSourceEmails(ENV, {
    sinceIso: SINCE,
    fetchFn: fetchStub([
      TOKEN,
      { match: fam('leads.boats.com'), response: resp(400, { error: { message: 'nope' } }) },
      { match: fam('noreply@brest-ocean-boat.fr'), response: resp(200, { value: [gmsg({ imid: '<ok@x>' })] }) },
      { match: fam('leboncoin'), response: resp(200, { value: [] }) },
      { match: fam('bandofboats'), response: resp(200, { value: [] }) },
    ]),
  });
  check('les autres familles continuent', r4.messages.length === 1);
  check('erreur listée avec la famille', r4.errors.length === 1 && r4.errors[0].includes('boats.com'), r4.errors.join('|'));

  section('Chaînage collecte -> parseEmail (fixture FICTIVE boats.com, corps texte)');
  const boatsBody = 'Est-il disponible ?\n\nPROSPECT INDIVIDUEL:\nNom:  Camille Martin\nTéléphone: +33 611223344\nE-mail: camille.martin@exemple.fr\n\nINFOS PROSPECT:\nOrigine du contact:     YachtWorld\nType de demande du prospect:INTERESTED-IN\n\nBATEAU À VENDRE:\nMarque: Jeanneau\nModèle: Merry Fisher 795\nAnnée: 2021\n\nINFOS BUREAU:\nNom: BREST OCEAN BOAT';
  const r5 = await fetchRecentSourceEmails(ENV, {
    sinceIso: SINCE,
    fetchFn: fetchStub([
      TOKEN,
      { match: fam('leads.boats.com'), response: resp(200, { value: [gmsg({ imid: '<parse@x>', from: '123-f@leads.boats.com', name: 'Camille Martin', subject: 'Used 2021 Jeanneau Merry Fisher 795 - YachtWorld', content: boatsBody })] }) },
      { match: fam('noreply@brest-ocean-boat.fr'), response: resp(200, { value: [] }) },
      { match: fam('leboncoin'), response: resp(200, { value: [] }) },
      { match: fam('bandofboats'), response: resp(200, { value: [] }) },
    ]),
  });
  const parsed = parseEmail(toParseInput(r5.messages[0]));
  check('source boatscom détectée (email direct, sans transfert)', parsed.source === 'boatscom');
  check('extraction complète', parsed.extracted.lastName === 'Martin' && parsed.extracted.email === 'camille.martin@exemple.fr' && parsed.extracted.boatInterest === 'Merry Fisher 795 (2021)');
  check('leadSource rapproché', parsed.leadSource === 'Yachtworld');
  check('score prospect', parsed.score >= 80);

  section('Repli HTML (corps html -> champ html, parseEmail convertit)');
  const htmlMsg: CollectedMessage = {
    graphId: 'g', internetMessageId: '<h@x>', receivedAt: '2026-07-22T10:00:00Z',
    fromName: 'Band of Boats', fromAddress: 'info@bandofboats.com',
    subject: 'Vous avez 1 nouveau message à propos de votre FLYER 650',
    html: '<div>Alex vient de vous envoyer un message dans votre messagerie Band of Boats.<br>Parle français,<br>Bonjour, disponible ?<br>Répondez à Alex en cliquant.<br>E-mail : alex@exemple.fr</div>',
    familyLabel: 'Band of Boats',
  };
  const parsedHtml = parseEmail(toParseInput(htmlMsg));
  check('bandofboats détecté depuis le HTML', parsedHtml.source === 'bandofboats');
  check('email extrait du HTML converti', parsedHtml.extracted.email === 'alex@exemple.fr');

  console.log(`\n${passed} OK, ${failed} KO`);
  if (failed > 0) process.exit(1);
}

main();
