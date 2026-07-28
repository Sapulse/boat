/**
 * Harnais de la boîte de réception prospects (Étape A, maquette).
 *
 * Exécution : npx tsx scripts/harness-inbound.ts
 *
 * Prouve le module PUR src/lib/inbound.ts (seuils de score, tri de la file,
 * mapping email -> lead) et les INVARIANTS des fixtures de démo (ids uniques,
 * leadSource ∈ SOURCES, scores bornés, cas doublon voulu présent).
 */
import { scoreLevel, sortInboundByScore, buildLeadFromInbound } from '../src/lib/inbound';
import { MOCK_INBOUND_EMAILS } from '../src/data/mockInboundEmails';
import { normEmail, normPhone } from '../src/lib/duplicateLeads';
import { SOURCES } from '../src/data/constants';
import type { InboundEmail } from '../src/data/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

function mail(over: Partial<InboundEmail>): InboundEmail {
  return {
    id: 'm1', receivedAt: '2026-07-28 10:00', fromAddress: 'a@b.c', subject: 'Objet',
    excerpt: 'Message.', sourceLabel: 'Formulaire du site', leadSource: 'Site BOB',
    score: 50, scoreReasons: [], status: 'a_traiter',
    extracted: { firstName: 'A', lastName: 'B', email: 'a@b.c', phone: '0611223344', boatInterest: 'X', brand: 'Y' },
    ...over,
  };
}

function main() {
  section('scoreLevel : seuils 70 / 40');
  check('92 -> prospect', scoreLevel(92) === 'prospect');
  check('70 -> prospect (borne incluse)', scoreLevel(70) === 'prospect');
  check('69 -> a_verifier', scoreLevel(69) === 'a_verifier');
  check('40 -> a_verifier (borne incluse)', scoreLevel(40) === 'a_verifier');
  check('39 -> parasite', scoreLevel(39) === 'parasite');
  check('0 -> parasite', scoreLevel(0) === 'parasite');

  section('sortInboundByScore : score décroissant, récent d\'abord à égalité');
  const sorted = sortInboundByScore([
    mail({ id: 'low', score: 10 }),
    mail({ id: 'high', score: 90 }),
    mail({ id: 'mid-old', score: 50, receivedAt: '2026-07-26 08:00' }),
    mail({ id: 'mid-new', score: 50, receivedAt: '2026-07-28 08:00' }),
  ]);
  check('ordre high > mid-new > mid-old > low',
    sorted.map(m => m.id).join(',') === 'high,mid-new,mid-old,low',
    sorted.map(m => m.id).join(','));
  const input = [mail({ id: 'a', score: 1 }), mail({ id: 'b', score: 2 })];
  sortInboundByScore(input);
  check('ne mute pas le tableau d\'entrée', input[0].id === 'a');

  section('buildLeadFromInbound : mapping vers Omit<Lead, "id">');
  const src = mail({ score: 92, sourceDetail: 'YachtWorld' });
  const lead = buildLeadFromInbound(src, 'fred', '2026-07-28');
  check('source = leadSource', lead.source === 'Site BOB');
  check('commercial repris', lead.commercialId === 'fred');
  check('identité et coordonnées reprises',
    lead.firstName === 'A' && lead.lastName === 'B' && lead.email === 'a@b.c' && lead.phone === '0611223344');
  check('bateau repris', lead.boatInterest === 'X' && lead.brand === 'Y');
  check('statut nouveau', lead.status === 'nouveau');
  check('createdAt et contactDate = jour de validation', lead.createdAt === '2026-07-28' && lead.contactDate === '2026-07-28');
  check('commentaires : provenance + détail + objet + message',
    lead.comments.includes('Formulaire du site — YachtWorld') && lead.comments.includes('Objet : Objet') && lead.comments.includes('Message.'));
  check('score prospect -> chaud', lead.temperature === 'chaud');
  check('score moyen -> tiède', buildLeadFromInbound(mail({ score: 50 }), 'fred', '2026-07-28').temperature === 'tiede');
  check('« Non attribué » : commercialId vide accepté', buildLeadFromInbound(src, '', '2026-07-28').commercialId === '');

  section('Fixtures de démo : invariants');
  const ids = MOCK_INBOUND_EMAILS.map(m => m.id);
  check('ids uniques', new Set(ids).size === ids.length);
  check('tous « à traiter » au chargement', MOCK_INBOUND_EMAILS.every(m => m.status === 'a_traiter'));
  check('scores bornés 0..100', MOCK_INBOUND_EMAILS.every(m => m.score >= 0 && m.score <= 100));
  const badSources = MOCK_INBOUND_EMAILS.filter(m => !SOURCES.includes(m.leadSource));
  check('leadSource ∈ SOURCES (spec §4)', badSources.length === 0, badSources.map(m => m.leadSource).join(','));
  check('les 3 niveaux de score sont représentés',
    new Set(MOCK_INBOUND_EMAILS.map(m => scoreLevel(m.score))).size === 3);

  section('Cas doublon voulu : boats.com et relance site = même prospect');
  const boats = MOCK_INBOUND_EMAILS.find(m => m.id === 'in-boats-antares');
  const relance = MOCK_INBOUND_EMAILS.find(m => m.id === 'in-site-relance');
  check('les deux fixtures existent', !!boats && !!relance);
  if (boats && relance) {
    check('même email normalisé', normEmail(boats.extracted.email) === normEmail(relance.extracted.email));
    check('même téléphone normalisé (formats différents)', normPhone(boats.extracted.phone) === normPhone(relance.extracted.phone));
  }

  console.log(`\n${passed} OK, ${failed} KO`);
  if (failed > 0) process.exit(1);
}

main();
