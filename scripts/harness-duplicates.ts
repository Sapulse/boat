/**
 * Harnais de détection de doublons de leads (correctif audit #2).
 *
 * Exécution : npx tsx scripts/harness-duplicates.ts
 *
 * Prouve le module PUR src/lib/duplicateLeads.ts : normalisation email/tél et
 * détection non bloquante (email OU tél), y compris variantes d'indicatif.
 */
import { normEmail, normPhone, findDuplicateLeads, countImportOverlap } from '../src/lib/duplicateLeads';
import type { Lead } from '../src/data/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

function lead(over: Partial<Lead>): Lead {
  return {
    id: 'x', createdAt: '2026-01-01', source: 'Tel', commercialId: 'c1',
    firstName: 'A', lastName: 'B', phone: '', email: '', boatType: 'Moteur',
    boatCondition: 'Neuf', boatInterest: '', brand: '', budget: null, status: 'nouveau',
    contactDate: '', quoteAmount: null, probability: null, currentBoat: '', comments: '',
    deliveryDate: '', temperature: 'tiede', priority: 'normale', nextActionType: '',
    nextActionDate: '', lastActionDate: '', lossReason: '', signedAt: '', lostAt: '', reportedAt: '',
    ...over,
  };
}

function main() {
  section('normEmail : trim + minuscules');
  check('casse + espaces ignorés', normEmail('  Jean.Dupont@Test.FR ') === 'jean.dupont@test.fr');
  check('vide -> ""', normEmail('') === '' && normEmail(undefined) === '' && normEmail(null) === '');

  section('normPhone : numéro national significatif (indicatif FR ignoré)');
  check('06 12 34 56 78 -> 612345678', normPhone('06 12 34 56 78') === '612345678');
  check('+33 6 12 34 56 78 -> 612345678', normPhone('+33 6 12 34 56 78') === '612345678');
  check('0033612345678 -> 612345678', normPhone('0033612345678') === '612345678');
  check('+33 (0)6 12 34 56 78 -> 612345678', normPhone('+33 (0)6 12 34 56 78') === '612345678');
  check('0298765432 (fixe) -> 298765432', normPhone('0298765432') === '298765432');
  check('vide -> ""', normPhone('') === '' && normPhone(undefined) === '');
  check('deux formats du même numéro sont égaux', normPhone('06.12.34.56.78') === normPhone('+33612345678'));

  section('findDuplicateLeads : email OU téléphone, self exclu, vides ignorés');
  const base = [
    lead({ id: 'l1', firstName: 'Marie', lastName: 'Martin', email: 'marie@x.fr', phone: '0611111111' }),
    lead({ id: 'l2', firstName: 'Paul', lastName: 'Durand', email: '', phone: '0622222222' }),
    lead({ id: 'l3', firstName: 'Luc', lastName: 'Petit', email: 'luc@x.fr', phone: '' }),
  ];
  check('même email (casse diff.) détecté', findDuplicateLeads(base, { email: 'MARIE@X.FR', phone: '' }).some(l => l.id === 'l1'));
  check('même tél (format diff.) détecté', findDuplicateLeads(base, { email: '', phone: '+33 6 22 22 22 22' }).some(l => l.id === 'l2'));
  check('email OU tél : l\'un suffit', findDuplicateLeads(base, { email: 'luc@x.fr', phone: '0699999999' }).some(l => l.id === 'l3'));
  check('aucun match -> []', findDuplicateLeads(base, { email: 'neuf@x.fr', phone: '0700000000' }).length === 0);
  check('candidat sans email ni tél -> [] (pas de faux positif)', findDuplicateLeads(base, { email: '', phone: '' }).length === 0);
  check('excludeId : un lead ne se détecte pas lui-même', findDuplicateLeads(base, { email: 'marie@x.fr', phone: '0611111111' }, 'l1').length === 0);
  check('deux existants peuvent matcher', findDuplicateLeads(
    [lead({ id: 'a', email: 'dup@x.fr' }), lead({ id: 'b', email: 'dup@x.fr' })],
    { email: 'dup@x.fr', phone: '' },
  ).length === 2);

  section('countImportOverlap : combien de candidats recouvrent la base');
  const cands = [
    { email: 'marie@x.fr', phone: '' },   // recouvre l1
    { email: '', phone: '0622222222' },   // recouvre l2
    { email: 'nouveau@x.fr', phone: '0700000000' }, // aucun
  ];
  check('2 des 3 candidats recouvrent la base', countImportOverlap(cands, base) === 2);
  check('base vide -> 0 recouvrement', countImportOverlap(cands, []) === 0);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais doublons : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  if (failed > 0) process.exitCode = 1;
  else console.log('Tous les invariants tiennent. ✅');
}

main();
