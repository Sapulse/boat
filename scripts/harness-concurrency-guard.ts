/**
 * Harnais de la détection de CONFLIT MULTI-POSTES (src/lib/concurrencyGuard.ts).
 *
 * Exécution : npx tsx scripts/harness-concurrency-guard.ts
 *
 * Cœur PUR, aucune base, aucun réseau. Le scénario de référence est celui du
 * cadrage : Océane ouvre la fiche, Tom modifie le statut et le montant, Océane
 * enregistre — ses champs à elle ne doivent PAS être signalés, ceux de Tom si.
 */
import type { Lead } from '../src/data/types';
import { diffLeadForConflict, formatLeadValue, canCheckConflict } from '../src/lib/concurrencyGuard';

// `toLocaleString('fr-FR')` separe les milliers par une espace INSECABLE (U+202F
// ou U+00A0), pas par une espace simple : on normalise avant de comparer, sinon
// l'assertion echoue sur un caractere invisible.
const norm = (s: string) => s.replace(/\s/g, ' ');

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

const base = (over: Partial<Lead> = {}): Lead => ({
  id: 'l1', createdAt: '2026-06-01', source: 'Tel', commercialId: 'oceane',
  firstName: 'Jean', lastName: 'Dupont', phone: '0600000000', email: 'j@test.fr',
  boatType: 'Moteur', boatCondition: 'Neuf', boatInterest: 'Antares 9', brand: 'Beneteau',
  budget: 50000, status: 'negociation', contactDate: '2026-06-02', quoteAmount: null,
  probability: null, currentBoat: '', comments: 'RAS', deliveryDate: '', temperature: 'tiede',
  priority: 'normale', nextActionType: '', nextActionDate: '', lastActionDate: '2026-06-05',
  lossReason: '', signedAt: '', lostAt: '', reportedAt: '', ...over,
} as Lead);

const NAMES: Record<string, string> = { oceane: 'Océane', tom: 'Tom', fred: 'Fred' };
const nameOf = (id: string) => NAMES[id] ?? id;

section('Aucun conflit : le serveur est identique à ma base de départ');
{
  const d = diffLeadForConflict(base(), base(), nameOf);
  check('liste vide -> enregistrement direct', d.length === 0, JSON.stringify(d));
}

section('Le scénario Océane / Tom');
{
  // Océane a ouvert la fiche (base). Tom a passé le lead en Signé + saisi le montant.
  const serveur = base({ status: 'signe', quoteAmount: 48000, signedAt: '2026-07-30' });
  const d = diffLeadForConflict(base(), serveur, nameOf);
  check('3 champs signalés', d.length === 3, d.map(x => x.field).join(','));
  check('le statut est signalé EN PREMIER (le plus lourd de conséquence)', d[0].field === 'status');
  check('libellés humains, pas des valeurs techniques',
    d[0].mine === 'Négociation' && d[0].theirs === 'Signé', `${d[0].mine} -> ${d[0].theirs}`);
  check('montant formaté en euros', d.some(x => x.field === 'quoteAmount' && norm(x.theirs) === '48 000 €'),
    JSON.stringify(d.find(x => x.field === 'quoteAmount')));
  check('un champ vide est dit « vide », pas laissé blanc',
    d.find(x => x.field === 'quoteAmount')?.mine === 'vide');
}

section('Ce que MOI je modifie ne doit jamais apparaître');
{
  // La comparaison porte sur baseline vs serveur — le brouillon n'entre pas en jeu.
  // Océane a changé le commentaire dans son formulaire : le serveur ne l'a pas vu,
  // et cela ne doit produire AUCUN signalement.
  const d = diffLeadForConflict(base(), base(), nameOf);
  check('mon propre brouillon n\'est pas comparé', d.length === 0);
}

section('Réattribution : le commercial est nommé, pas son identifiant');
{
  const d = diffLeadForConflict(base({ commercialId: 'oceane' }), base({ commercialId: 'tom' }), nameOf);
  check('1 champ', d.length === 1 && d[0].field === 'commercialId');
  check('noms résolus', d[0].mine === 'Océane' && d[0].theirs === 'Tom', `${d[0].mine} -> ${d[0].theirs}`);
  const raw = diffLeadForConflict(base({ commercialId: 'oceane' }), base({ commercialId: 'zzz' }));
  check('sans résolveur, on affiche l\'identifiant brut plutôt que rien', raw[0].theirs === 'zzz');
}

section('Les différentes façons d\'être vide ne sont PAS des conflits');
{
  const d1 = diffLeadForConflict(base({ comments: '' }), base({ comments: undefined as unknown as string }), nameOf);
  check("'' vs undefined -> aucun conflit", d1.length === 0, JSON.stringify(d1));
  const d2 = diffLeadForConflict(base({ quoteAmount: null }), base({ quoteAmount: undefined }), nameOf);
  check('null vs undefined -> aucun conflit', d2.length === 0, JSON.stringify(d2));
  const d3 = diffLeadForConflict(base({ nextActionTime: undefined }), base({ nextActionTime: '' }), nameOf);
  check("undefined vs '' sur un champ optionnel -> aucun conflit", d3.length === 0);
  // Mais passer de vide à une VRAIE valeur en est un.
  const d4 = diffLeadForConflict(base({ comments: '' }), base({ comments: 'Rappeler lundi' }), nameOf);
  check('vide -> valeur réelle EST un conflit', d4.length === 1 && d4[0].theirs === 'Rappeler lundi');
}

section('Un champ effacé par l\'autre poste est signalé');
{
  const d = diffLeadForConflict(base({ comments: 'Important' }), base({ comments: '' }), nameOf);
  check('valeur -> vide EST un conflit', d.length === 1);
  check('affiché « Important » -> « vide »', d[0].mine === 'Important' && d[0].theirs === 'vide');
}

section('Conflit massif : tous les champs surveillés');
{
  const serveur = base({
    status: 'perdu', commercialId: 'fred', budget: 90000, quoteAmount: 12000, probability: 25,
    temperature: 'froid', priority: 'haute', firstName: 'Marc', lastName: 'Martin',
    phone: '0700000000', email: 'm@test.fr', comments: 'Autre chose', lossReason: 'Prix',
    lastActionDate: '2026-07-29', contactDate: '2026-07-01', source: 'Salon',
    boatType: 'Voile', boatCondition: 'BO', boatInterest: 'Oceanis', brand: 'Jeanneau',
    currentBoat: 'Cap Camarat', deliveryDate: '2026-12-01', lostAt: '2026-07-30',
    nextActionType: 'appel', nextActionDate: '2026-08-01',
  });
  const d = diffLeadForConflict(base(), serveur, nameOf);
  check('les 25 champs modifiés sont tous signalés', d.length === 25, String(d.length));
  check('aucun libellé vide', d.every(x => x.label.length > 0));
  check('aucun champ dupliqué', new Set(d.map(x => x.field)).size === d.length);
  check('probabilité en %', d.some(x => x.field === 'probability' && x.theirs === '25 %'));
}

section('formatLeadValue — cas isolés');
{
  check('budget nul -> vide', formatLeadValue('budget', null) === 'vide');
  check('budget 0 -> 0 €, PAS vide (un budget à zéro est une information)',
    formatLeadValue('budget', 0) === '0 €', formatLeadValue('budget', 0));
  check('grand montant séparé par milliers',
    norm(formatLeadValue('quoteAmount', 1250000)) === '1 250 000 €',
    formatLeadValue('quoteAmount', 1250000));
  check('statut inconnu -> valeur brute plutôt que rien',
    formatLeadValue('status', 'zzz') === 'zzz');
  check('texte simple inchangé', formatLeadValue('comments', 'Bonjour') === 'Bonjour');
}

section('Garde outbox : pas de faux conflit contre mes propres écritures');
{
  check('aucune écriture en attente -> contrôle exploitable', canCheckConflict(0));
  check('1 écriture en attente -> contrôle sauté', !canCheckConflict(1));
  check('plusieurs en attente -> contrôle sauté', !canCheckConflict(7));
}

console.log(`\n${passed} OK, ${failed} KO`);
if (failed > 0) process.exit(1);
