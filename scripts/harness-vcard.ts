/**
 * Harnais vCard (lot chore/petits-moyens, etape 5).
 *
 * Execution : npx tsx scripts/harness-vcard.ts
 * (hors tsc -b et hors bundle Vite, comme les autres harnais.)
 *
 * Couvre :
 *  - N11 : decodage QUOTED-PRINTABLE (vCard 2.1) — =C3=A9 -> é, prefixe
 *    ENCODING= facultatif, CHARSET declare, soft line breaks "=", =3B dans un
 *    champ, proprietes non-QP inchangees.
 *  - Non-regression du parser existant : echappement \; \, \\ (split sans
 *    lookbehind), depliage espace/tab, CRLF/LF, multi-cartes, fallback FN,
 *    cartes vides filtrees, parametres TYPE ignores, round-trip generate->parse.
 *  - Normalisation + doublons (email/telephone) et factory createLeadFromContact.
 */

import {
  generateVCard,
  parseVCards,
  normalizeEmail,
  normalizePhone,
  splitNewVsDuplicates,
  createLeadFromContact,
} from '../src/lib/vcard';
import type { Lead } from '../src/data/types';

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    failed++;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n— ${title}`);
}

function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1', createdAt: '2026-06-01', source: 'Tel', commercialId: 'fred',
    firstName: 'Jean', lastName: 'Test', phone: '06 12 34 56 78', email: 'jean.test@email.fr',
    boatType: 'Moteur', boatCondition: 'Neuf', boatInterest: 'Antares 9', brand: 'Beneteau',
    budget: 50000, status: 'contacte', contactDate: '2026-06-02', quoteAmount: null,
    probability: null, currentBoat: '', comments: '', deliveryDate: '', temperature: 'tiede',
    priority: 'normale', nextActionType: '', nextActionDate: '', lastActionDate: '2026-06-05',
    lossReason: '', signedAt: '', lostAt: '', reportedAt: '',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Non-regression — generation
// ---------------------------------------------------------------------------

section('Generation — structure et echappement');
{
  const vcf = generateVCard(makeLead({ lastName: 'Le Goff; fils', firstName: 'Anne, Marie' }), 'Fred');
  check('BEGIN/END + VERSION 3.0', vcf.startsWith('BEGIN:VCARD\r\nVERSION:3.0') && vcf.endsWith('END:VCARD'));
  check("';' echappe dans N", vcf.includes('N:Le Goff\\; fils;Anne\\, Marie;;;'));
  check('TEL et EMAIL presents', vcf.includes('TEL;TYPE=CELL:06 12 34 56 78') && vcf.includes('EMAIL;TYPE=INTERNET:jean.test@email.fr'));
  check('NOTE presente (bateau/commercial)', vcf.includes('NOTE:') && vcf.includes('Commercial: Fred'));

  const sans = generateVCard(makeLead({ phone: '', email: '' }), 'Fred');
  check('TEL/EMAIL omis si vides', !sans.includes('TEL;') && !sans.includes('EMAIL;'));
}

// ---------------------------------------------------------------------------
// Non-regression — parsing 3.0 (echappement, depliage, multi-cartes)
// ---------------------------------------------------------------------------

section("Parsing 3.0 — echappement \\; \\, \\\\ (split sans lookbehind)");
{
  const [c] = parseVCards('BEGIN:VCARD\r\nN:Dupont\\;Junior;Jean\\,Paul;;;\r\nEND:VCARD');
  check("lastName contient le ';' echappe", c.lastName === 'Dupont;Junior', `=${c.lastName}`);
  check("firstName contient la ',' echappee", c.firstName === 'Jean,Paul', `=${c.firstName}`);
  const [d] = parseVCards('BEGIN:VCARD\nN:Back\\\\slash;Eve;;;\nEND:VCARD');
  check('antislash echappe restitue', d.lastName === 'Back\\slash', `=${d.lastName}`);
}

section('Parsing — depliage (folding espace/tab), CRLF et LF');
{
  const folded = 'BEGIN:VCARD\r\nN:Tres-Long-Nom-\r\n De-Famille;Luc;;;\r\nEND:VCARD';
  const [c] = parseVCards(folded);
  check('ligne pliee CRLF+espace recollee', c.lastName === 'Tres-Long-Nom-De-Famille', `=${c.lastName}`);
  const lf = parseVCards('BEGIN:VCARD\nFN:Paul Petit\nTEL:0601020304\nEND:VCARD');
  check('fichier LF seul accepte', lf.length === 1 && lf[0].phone === '0601020304');
}

section('Parsing — multi-cartes, FN fallback, params TYPE, cartes vides');
{
  const text = [
    'BEGIN:VCARD', 'N:Martin;Paul;;;', 'TEL;TYPE=CELL:0611111111', 'END:VCARD',
    'BEGIN:VCARD', 'FN:Marie Claire Durand', 'EMAIL;TYPE=HOME:m@d.fr', 'END:VCARD',
    'BEGIN:VCARD', 'X-INCONNU:abc', 'END:VCARD',
  ].join('\r\n');
  const cs = parseVCards(text);
  check('2 cartes exploitables (la vide est filtree)', cs.length === 2, `=${cs.length}`);
  check('carte 1 : N structure', cs[0].lastName === 'Martin' && cs[0].firstName === 'Paul');
  check('carte 2 : fallback FN (1er mot = prenom)', cs[1].firstName === 'Marie' && cs[1].lastName === 'Claire Durand');
  check('param TYPE ignore sur TEL/EMAIL', cs[0].phone === '0611111111' && cs[1].email === 'm@d.fr');
}

section('Round-trip generate -> parse');
{
  const lead = makeLead({ lastName: 'Quéméneur; cadet', firstName: 'Aël' });
  const [c] = parseVCards(generateVCard(lead, 'Fred'));
  check('nom restitue a l\'identique (accents + ; echappe)', c.lastName === 'Quéméneur; cadet' && c.firstName === 'Aël',
    `=${c.lastName}/${c.firstName}`);
  check('tel/email restitues', c.phone === lead.phone && c.email === lead.email);
}

// ---------------------------------------------------------------------------
// N11 — QUOTED-PRINTABLE (vCard 2.1)
// ---------------------------------------------------------------------------

section('QP — decodage UTF-8 de base (=C3=A9 -> é)');
{
  const [c] = parseVCards('BEGIN:VCARD\r\nN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:G=C3=A9rard;Fran=C3=A7ois;;;\r\nEND:VCARD');
  check('lastName decode', c.lastName === 'Gérard', `=${c.lastName}`);
  check('firstName decode', c.firstName === 'François', `=${c.firstName}`);
}

section('QP — prefixe ENCODING= facultatif (forme 2.1 historique)');
{
  const [c] = parseVCards('BEGIN:VCARD\r\nFN;QUOTED-PRINTABLE:Ren=C3=A9 H=C3=A9bert\r\nEND:VCARD');
  check('FN decode via fallback', c.firstName === 'René' && c.lastName === 'Hébert', `=${c.firstName}/${c.lastName}`);
}

section('QP — soft line break ("=" en fin de ligne)');
{
  const text = 'BEGIN:VCARD\r\nN;ENCODING=QUOTED-PRINTABLE:K=C3=A9r=\r\navel;Yann;;;\r\nEND:VCARD';
  const [c] = parseVCards(text);
  check('valeur recollee puis decodee', c.lastName === 'Kéravel', `=${c.lastName}`);
  check('champ suivant intact', c.firstName === 'Yann');
}

section('QP — =3B (point-virgule de donnee) ne casse pas la structure');
{
  const [c] = parseVCards('BEGIN:VCARD\r\nN;ENCODING=QUOTED-PRINTABLE:Dupont=3BJunior;Jean;;;\r\nEND:VCARD');
  check("lastName contient le ';' decode", c.lastName === 'Dupont;Junior', `=${c.lastName}`);
  check('firstName non decale', c.firstName === 'Jean', `=${c.firstName}`);
}

section('QP — EMAIL/TEL decodes ; "=" isole tolere');
{
  const [c] = parseVCards('BEGIN:VCARD\r\nEMAIL;ENCODING=QUOTED-PRINTABLE:ren=C3=A9@mer.fr\r\nTEL;ENCODING=QUOTED-PRINTABLE:06 99 88 77 66\r\nEND:VCARD');
  check('email decode', c.email === 'rené@mer.fr', `=${c.email}`);
  check('tel sans sequence QP inchange', c.phone === '06 99 88 77 66');
  const [t] = parseVCards('BEGIN:VCARD\r\nFN;ENCODING=QUOTED-PRINTABLE:a=zerty\r\nEND:VCARD');
  check('"=" non suivi de 2 hexas conserve', t.firstName === 'a=zerty', `=${t.firstName}`);
}

section('QP — CHARSET ISO-8859-1 et charset inconnu (fallback UTF-8)');
{
  const [c] = parseVCards('BEGIN:VCARD\r\nFN;ENCODING=QUOTED-PRINTABLE;CHARSET=ISO-8859-1:Ren=E9\r\nEND:VCARD');
  check('latin-1 decode (=E9 -> é)', c.firstName === 'René', `=${c.firstName}`);
  const [u] = parseVCards('BEGIN:VCARD\r\nFN;ENCODING=QUOTED-PRINTABLE;CHARSET=X-BIDON:Ren=C3=A9\r\nEND:VCARD');
  check('charset inconnu -> fallback UTF-8', u.firstName === 'René', `=${u.firstName}`);
}

section('QP — les proprietes NON-QP ne sont pas decodees');
{
  const [c] = parseVCards('BEGIN:VCARD\r\nFN:Promo =C3=A9quipe\r\nEND:VCARD');
  check('"=C3=A9" reste litteral sans declaration QP', c.firstName === 'Promo' && c.lastName === '=C3=A9quipe',
    `=${c.lastName}`);
}

// ---------------------------------------------------------------------------
// Non-regression — normalisation, doublons, factory
// ---------------------------------------------------------------------------

section('Normalisation + doublons');
{
  check('normalizeEmail trim+lower', normalizeEmail('  Jean.TEST@Email.FR ') === 'jean.test@email.fr');
  check('normalizePhone garde chiffres et +', normalizePhone('+33 6 12-34.56(78)') === '+33612345678');

  const existing = [makeLead({ email: 'jean.test@email.fr', phone: '06 12 34 56 78' })];
  const { fresh, duplicates } = splitNewVsDuplicates([
    { firstName: 'A', lastName: 'A', phone: '0612345678', email: '' },          // doublon tel
    { firstName: 'B', lastName: 'B', phone: '', email: 'JEAN.TEST@email.fr' },  // doublon email
    { firstName: 'C', lastName: 'C', phone: '0612345678', email: 'jean.test@email.fr' }, // both
    { firstName: 'D', lastName: 'D', phone: '0699999999', email: 'd@d.fr' },    // nouveau
    { firstName: 'E', lastName: 'E', phone: '', email: '' },                    // vide ne matche jamais
  ], existing);
  check('3 doublons / 2 nouveaux', duplicates.length === 3 && fresh.length === 2, `${duplicates.length}/${fresh.length}`);
  check('raisons phone/email/both correctes',
    duplicates[0].reason === 'phone' && duplicates[1].reason === 'email' && duplicates[2].reason === 'both');
  check('les valeurs vides ne matchent jamais entre elles', fresh.some(f => f.firstName === 'E'));
}

section('Factory createLeadFromContact');
{
  const lead = createLeadFromContact({ firstName: 'Léa', lastName: 'Morvan', phone: '0601', email: 'l@m.fr' });
  check('statut nouveau, commercial NON rattache', lead.status === 'nouveau' && lead.commercialId === '');
  check('identite reprise, jalons vides', lead.firstName === 'Léa' && lead.signedAt === '' && lead.contactDate === '');
}

// ---------------------------------------------------------------------------
// Bilan
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais vCard : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('Tous les invariants tiennent. ✅');
}
