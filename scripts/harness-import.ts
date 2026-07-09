/**
 * Harnais import de leads (chantier import/export, Étape 1).
 *
 * Exécution : npx tsx scripts/harness-import.ts
 * (hors tsc -b et hors bundle Vite, comme les autres harnais.)
 *
 * Couvre le helper PUR src/lib/importLeads.ts (aucune écriture) :
 *  - parsing CSV ';' (guillemets, "" échappés, ; et retours-ligne en cellule, BOM,
 *    en-têtes à espaces parasites) ;
 *  - transformations : dates FR->ISO (+ contrôle calendaire), montants, téléphone ;
 *  - tables de correspondance : commerciaux (fusion casse + orphelins), statut
 *    (« En conclusion » -> codes CRM), type, état (codes bruts Neuf/BO/DV) ;
 *  - option SIMPLE : pas d'actions, relances/Signé-Perdu résumés en commentaire,
 *    « Date de contact » -> contactDate ;
 *  - validation ligne par ligne (rejet des lignes sans identifiant) ;
 *  - buildPreview : stats, orphelins, commercialsToCreate.
 */

import {
  parseImportCsv, buildPreview, parseFrDate, parseAmount, cleanPhone,
  NON_ATTRIBUE, type RawRow,
} from '../src/lib/importLeads';
import type { LeadStatus } from '../src/data/types';

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(title: string) { console.log(`\n— ${title}`); }

const TODAY = '2026-07-09';

// En-têtes réels (avec espaces parasites, comme dans le fichier source).
const HEADER = 'Date de création;Source;Commercial;Nom;Prénom;Téléphone;Email;Type de bateau;Etat ;Intérêt bateau;Marque; Budget (€) ;En conclusion;Date de contact ;Relance 1;Relance 2;Négociation/Devis;Relance 3;Conclusion;Signé/Perdu; Montant devis (€) ;% Réalisation;Bateau actuel;Commentaires;Date de livraison';

// Fabrique une RawRow (clés = en-têtes TRIMMÉS) à partir de surcharges partielles.
function row(over: Partial<Record<string, string>> = {}): RawRow {
  const base: RawRow = {
    'Date de création': '', 'Source': '', 'Commercial': '', 'Nom': '', 'Prénom': '',
    'Téléphone': '', 'Email': '', 'Type de bateau': '', 'Etat': '', 'Intérêt bateau': '',
    'Marque': '', 'Budget (€)': '', 'En conclusion': '', 'Date de contact': '',
    'Relance 1': '', 'Relance 2': '', 'Négociation/Devis': '', 'Relance 3': '',
    'Conclusion': '', 'Signé/Perdu': '', 'Montant devis (€)': '', '% Réalisation': '',
    'Bateau actuel': '', 'Commentaires': '', 'Date de livraison': '',
  };
  return { ...base, ...over };
}

// ---------------------------------------------------------------------------
section('Dates FR -> ISO (+ contrôle calendaire)');
// ---------------------------------------------------------------------------
{
  check('07/09/2026 -> 2026-09-07', parseFrDate('07/09/2026') === '2026-09-07');
  check('1/2/2026 (non paddé) -> 2026-02-01', parseFrDate('1/2/2026') === '2026-02-01');
  check('année sur 2 chiffres 05/06/24 -> 2024-06-05', parseFrDate('05/06/24') === '2024-06-05');
  check('séparateur . accepté', parseFrDate('07.09.2026') === '2026-09-07');
  check('31/02/2026 (invalide) -> null', parseFrDate('31/02/2026') === null);
  check('anomalie 10:06:26 -> null', parseFrDate('10:06:26') === null);
  check('vide -> null', parseFrDate('') === null);
  check('texte -> null', parseFrDate('bientôt') === null);
}

// ---------------------------------------------------------------------------
section('Montants -> nombre');
// ---------------------------------------------------------------------------
{
  check('"64 900 €" -> 64900', parseAmount('64 900 €') === 64900);
  check('"34 000,00 €" -> 34000', parseAmount('34 000,00 €') === 34000);
  check('espace insécable "1 234 €" -> 1234', parseAmount('1 234 €') === 1234);
  check('"1 234,50" -> 1234.5', parseAmount('1 234,50') === 1234.5);
  check('vide -> null', parseAmount('') === null);
  check('"n/a" -> null', parseAmount('n/a') === null);
}

// ---------------------------------------------------------------------------
section('Téléphone — nettoyage a minima');
// ---------------------------------------------------------------------------
{
  check('espaces multiples réduits', cleanPhone('  06   07 76  04 08 ') === '06 07 76 04 08');
  check('+ et indicatif conservés (pas de reformatage)', cleanPhone('+31630954825') === '+31630954825');
}

// ---------------------------------------------------------------------------
section('Parsing CSV — guillemets, "" échappés, ; et \\n en cellule, BOM, en-têtes trimmés');
// ---------------------------------------------------------------------------
{
  const csv = '﻿' + HEADER + '\r\n' +
    '07/09/2026;Site BOB;tom;Dupont;Jean;06 07 08 09 10;J@X.FR;moteur;dv;Antares;Beneteau;64 900 €;Contacté;;;;;;;;;;;"Note ; avec point-virgule\net saut de ligne";\r\n' +
    '05/06/2026;LBC;FRED;"Le Goff ""dit le Grand""";Anne;;a@b.fr;voile;BO;Sun;Jeanneau;;Perdu;;;;;;;;;;;;';
  const rows = parseImportCsv(csv);
  check('2 lignes de données', rows.length === 2, `=${rows.length}`);
  check('en-tête "Etat " trimmé en clé "Etat"', rows[0]['Etat'] === 'dv', `=${rows[0]['Etat']}`);
  check('en-tête " Budget (€) " trimmé', rows[0]['Budget (€)'] === '64 900 €', `=${rows[0]['Budget (€)']}`);
  check('cellule avec ; et \\n préservée', rows[0]['Commentaires'] === 'Note ; avec point-virgule\net saut de ligne', `=${JSON.stringify(rows[0]['Commentaires'])}`);
  check('"" échappé -> guillemet simple', rows[1]['Nom'] === 'Le Goff "dit le Grand"', `=${rows[1]['Nom']}`);
}

// ---------------------------------------------------------------------------
section('Commerciaux — fusion de casse + orphelins');
// ---------------------------------------------------------------------------
{
  const p = buildPreview([
    row({ Nom: 'A', Commercial: 'TOM' }),
    row({ Nom: 'B', Commercial: 'tom ' }),
    row({ Nom: 'C', Commercial: 'océane' }),
    row({ Nom: 'D', Commercial: 'OCEANE' }),
    row({ Nom: 'E', Commercial: 'Camaret', Commentaires: 'rappel été' }),
    row({ Nom: 'F', Commercial: 'cmys' }),
    row({ Nom: 'G', Commercial: '' }),
    row({ Nom: 'H', Commercial: 'Inconnu' }),
  ], [], TODAY);
  const by = (n: string) => p.leads.find(l => l.lead.lastName === n)!;
  check('TOM/tom -> Tom', by('A').commercialName === 'Tom' && by('B').commercialName === 'Tom');
  check('océane/OCEANE -> Océane', by('C').commercialName === 'Océane' && by('D').commercialName === 'Océane');
  check('Camaret -> Non attribué + [Camaret] préfixé', by('E').commercialName === NON_ATTRIBUE && by('E').lead.comments.startsWith('[Camaret] rappel été'));
  check('cmys -> Non attribué + [cmys]', by('F').commercialName === NON_ATTRIBUE && by('F').lead.comments === '[cmys]');
  check('vide -> Non attribué (sans warning commercial)', by('G').commercialName === NON_ATTRIBUE && !by('G').warnings.some(w => w.includes('Commercial')));
  check('inconnu -> Non attribué + warning', by('H').commercialName === NON_ATTRIBUE && by('H').warnings.some(w => w.includes('inconnu')));
  check('orphelins comptés (Camaret+cmys+vide+inconnu = 4)', p.stats.orphans === 4, `=${p.stats.orphans}`);
}

// ---------------------------------------------------------------------------
section('Statut « En conclusion » -> codes CRM');
// ---------------------------------------------------------------------------
{
  const cases: [string, LeadStatus][] = [
    ['Perdu', 'perdu'], ['Contacté', 'contacte'], ['Reporté', 'reporte'],
    ['Nouveau', 'nouveau'], ['En cours', 'qualifie'], ['Client relancé', 'contacte'],
    ['Signé', 'signe'], ['Négociation', 'negociation'],
  ];
  const p = buildPreview(cases.map(([s], i) => row({ Nom: `L${i}`, 'En conclusion': s })), [], TODAY);
  cases.forEach(([src, code], i) => {
    check(`« ${src} » -> ${code}`, p.leads[i].lead.status === code, `=${p.leads[i].lead.status}`);
  });
  const empty = buildPreview([row({ Nom: 'Z' })], [], TODAY).leads[0];
  check('statut absent -> nouveau + warning', empty.lead.status === 'nouveau' && empty.warnings.some(w => w.includes('Statut')));
  const unk = buildPreview([row({ Nom: 'Y', 'En conclusion': 'Bizarre' })], [], TODAY).leads[0];
  check('statut inconnu -> nouveau + warning', unk.lead.status === 'nouveau' && unk.warnings.some(w => w.includes('inconnu')));
}

// ---------------------------------------------------------------------------
section('Type de bateau + État (codes bruts)');
// ---------------------------------------------------------------------------
{
  const p = buildPreview([
    row({ Nom: 'A', 'Type de bateau': 'MOTEUR', 'Etat': 'dv' }),
    row({ Nom: 'B', 'Type de bateau': 'moter', 'Etat': 'BO' }),
    row({ Nom: 'C', 'Type de bateau': 'voile', 'Etat': 'occasion' }),
    row({ Nom: 'D', 'Type de bateau': 'Semi-rigide', 'Etat': 'BN' }),
    row({ Nom: 'E', 'Type de bateau': 'sous-marin', 'Etat': 'neuf ou occasion' }),
    row({ Nom: 'F', 'Etat': 'Location' }),
  ], [], TODAY);
  const by = (n: string) => p.leads.find(l => l.lead.lastName === n)!;
  check('MOTEUR -> Moteur / dv -> DV', by('A').lead.boatType === 'Moteur' && by('A').lead.boatCondition === 'DV');
  check('faute "moter" -> Moteur / BO -> BO', by('B').lead.boatType === 'Moteur' && by('B').lead.boatCondition === 'BO');
  check('voile -> Voile / occasion -> BO', by('C').lead.boatType === 'Voile' && by('C').lead.boatCondition === 'BO');
  check('Semi-rigide / BN -> Neuf', by('D').lead.boatType === 'Semi-rigide' && by('D').lead.boatCondition === 'Neuf');
  check('type inconnu -> "" + warning', by('E').lead.boatType === '' && by('E').warnings.some(w => w.includes('Type')));
  check('"neuf ou occasion" -> Neuf + warning ambigu', by('E').lead.boatCondition === 'Neuf' && by('E').warnings.some(w => w.includes('ambigu')));
  check('Location -> "" + warning', by('F').lead.boatCondition === '' && by('F').warnings.some(w => w.includes('Location')));
}

// ---------------------------------------------------------------------------
section('Option simple — contactDate + résumé de suivi en commentaire (aucune action)');
// ---------------------------------------------------------------------------
{
  const p = buildPreview([row({
    Nom: 'Suivi', 'En conclusion': 'Signé',
    'Date de contact': '01/03/2026',
    'Relance 1': '10/03/2026', 'Relance 2': '20/03/2026',
    'Négociation/Devis': '25/03/2026', 'Signé/Perdu': '05/04/2026',
    Commentaires: 'client sérieux',
  })], [], TODAY);
  const l = p.leads[0];
  check('Date de contact -> contactDate ISO', l.lead.contactDate === '2026-03-01', `=${l.lead.contactDate}`);
  check('commentaire = texte + résumé Suivi', l.lead.comments.startsWith('client sérieux') && l.lead.comments.includes('Suivi importé —'));
  check('résumé contient Relance 1/2, Négo/Devis, Signé/Perdu (valeurs brutes)',
    ['Relance 1 : 10/03/2026', 'Relance 2 : 20/03/2026', 'Négociation/Devis : 25/03/2026', 'Signé/Perdu : 05/04/2026'].every(s => l.lead.comments.includes(s)));
  check('aucune action générée (option simple)', p.stats.actions === 0);
  check('jalons signedAt/lostAt vides (pas de mapping en champ)', l.lead.signedAt === '' && l.lead.lostAt === '');
}

// ---------------------------------------------------------------------------
section('createdAt requis — repli sur today');
// ---------------------------------------------------------------------------
{
  const ok = buildPreview([row({ Nom: 'A', 'Date de création': '12/05/2026' })], [], TODAY).leads[0];
  check('date valide conservée (aucun warning de date)', ok.lead.createdAt === '2026-05-12' && !ok.warnings.some(w => w.includes('Date de création')));
  const bad = buildPreview([row({ Nom: 'B', 'Date de création': '10:06:26' })], [], TODAY).leads[0];
  check('date illisible -> today + warning', bad.lead.createdAt === TODAY && bad.warnings.some(w => w.includes('Date de création')));
  const none = buildPreview([row({ Nom: 'C' })], [], TODAY).leads[0];
  check('date absente -> today + warning', none.lead.createdAt === TODAY && none.warnings.some(w => w.includes('absente')));
}

// ---------------------------------------------------------------------------
section('Validation ligne par ligne — rejet sans identifiant');
// ---------------------------------------------------------------------------
{
  const p = buildPreview([
    row({ Nom: 'Bon', Email: 'x@y.fr' }),
    row({ Source: 'LBC', 'En conclusion': 'Perdu' }), // aucune identité -> rejet
    row({ Prénom: 'Solo' }),                          // prénom seul -> accepté
  ], [], TODAY);
  check('1 rejet (ligne sans nom/prénom/tél/email)', p.rejected.length === 1, `=${p.rejected.length}`);
  check('n° de ligne du rejet = 3', p.rejected[0].line === 3, `=${p.rejected[0].line}`);
  check('raison explicite', p.rejected[0].reasons[0].includes('aucun identifiant'));
  check('2 leads valides (dont prénom seul)', p.leads.length === 2, `=${p.leads.length}`);
  check('une ligne KO ne bloque pas les autres', p.leads.some(l => l.lead.lastName === 'Bon'));
}

// ---------------------------------------------------------------------------
section('buildPreview — stats, lignes vides ignorées, commercialsToCreate');
// ---------------------------------------------------------------------------
{
  const p = buildPreview([
    row({ Nom: 'A', Commercial: 'Tom' }),
    row(),                                   // ligne vide -> ni comptée ni rejetée
    row({ Nom: 'B', Commercial: 'Camaret' }),
    row({ Source: 'X' }),                    // pas d'identité -> rejetée
  ], [{ name: 'Tom' }], TODAY);
  check('total = 2 leads + 1 rejet (vide ignorée)', p.stats.total === 3 && p.stats.valid === 2 && p.stats.rejected === 1, JSON.stringify(p.stats));
  check('Tom déjà en base -> pas recréé, Non attribué à créer', p.commercialsToCreate.length === 1 && p.commercialsToCreate[0] === NON_ATTRIBUE, p.commercialsToCreate.join(','));
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais import : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exitCode = 1;
else console.log('Tous les invariants tiennent. ✅');
