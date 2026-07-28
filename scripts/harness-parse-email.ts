/**
 * Harnais d'extraction email (chantier import prospects, « cerveau »).
 *
 * Exécution : npx tsx scripts/harness-parse-email.ts
 *
 * MOTEUR SANS DONNÉE PERSONNELLE : les valeurs attendues (noms, emails,
 * téléphones réels extraits des .eml) vivent dans
 * scripts/harness-parse-email.expected.local.json — GITIGNORÉ, même statut
 * RGPD que l'échantillon docs/emails-echantillon/*.eml lui-même. Sur un poste
 * sans l'échantillon ou sans le fichier d'attentes, le harnais SKIPPE
 * proprement (exit 0). Ce fichier-ci est committable : il ne contient que la
 * mécanique de vérification.
 *
 * Schéma d'une attente (toutes les clés optionnelles sauf key/label) :
 *   key                 regex reconnaissant le nom du fichier .eml
 *   label               libellé affiché
 *   source              famille attendue (boatscom | site | leboncoin | ...)
 *   leadSource          valeur Lead.source attendue (∈ SOURCES)
 *   sourceDetailIncludes  sous-chaîne du détail de source
 *   band                [min, max] du score
 *   extracted           égalités champ par champ (partiel)
 *   phoneStartsWith     préfixe du téléphone extrait
 *   boatInterestIncludes  sous-chaîne du bateau extrait
 *   excerptIncludes     sous-chaînes attendues dans l'extrait
 *   noteMatches         listes de sous-chaînes devant cohabiter dans UNE note
 *   reasonsInclude      sous-chaînes attendues dans les raisons du score
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeEml } from './emlDecode';
import { parseEmail, type ParsedEmail } from '../src/lib/email/parseEmail';
import type { InboundExtracted } from '../src/data/types';

const DIR = join(import.meta.dirname, '..', 'docs', 'emails-echantillon');
const EXPECTED = join(import.meta.dirname, 'harness-parse-email.expected.local.json');

interface Expectation {
  key: string;
  label: string;
  source?: string;
  leadSource?: string;
  sourceDetailIncludes?: string;
  band?: [number, number];
  extracted?: Partial<InboundExtracted>;
  phoneStartsWith?: string;
  boatInterestIncludes?: string;
  excerptIncludes?: string[];
  noteMatches?: string[][];
  reasonsInclude?: string[];
}

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}

function runExpectation(e: Expectation, p: ParsedEmail) {
  if (e.source) check(`source ${e.source}`, p.source === e.source, p.source);
  if (e.leadSource) check(`leadSource « ${e.leadSource} »`, p.leadSource === e.leadSource, p.leadSource);
  if (e.sourceDetailIncludes) {
    check(`détail de source contient « ${e.sourceDetailIncludes} »`, p.sourceDetail?.includes(e.sourceDetailIncludes) === true, p.sourceDetail);
  }
  for (const [k, v] of Object.entries(e.extracted ?? {})) {
    check(`extrait ${k} = « ${v} »`, p.extracted[k as keyof InboundExtracted] === v, String(p.extracted[k as keyof InboundExtracted]));
  }
  if (e.phoneStartsWith) check(`téléphone commence par ${e.phoneStartsWith}`, p.extracted.phone.startsWith(e.phoneStartsWith), p.extracted.phone);
  if (e.boatInterestIncludes) check(`bateau contient « ${e.boatInterestIncludes} »`, p.extracted.boatInterest.includes(e.boatInterestIncludes), p.extracted.boatInterest);
  for (const s of e.excerptIncludes ?? []) check(`extrait de message contient « ${s} »`, p.excerpt.includes(s));
  for (const parts of e.noteMatches ?? []) {
    check(`une note contient [${parts.join(' + ')}]`, p.notes.some(n => parts.every(sub => n.includes(sub))), p.notes.join(' | '));
  }
  for (const s of e.reasonsInclude ?? []) check(`raisons du score contiennent « ${s} »`, p.scoreReasons.some(r => r.includes(s)), p.scoreReasons.join(' | '));
  if (e.band) check(`score ${p.score} dans [${e.band[0]}, ${e.band[1]}]`, p.score >= e.band[0] && p.score <= e.band[1], p.scoreReasons.join(' | '));
}

function main() {
  if (!existsSync(DIR) || !existsSync(EXPECTED)) {
    console.log('SKIP : échantillon .eml et/ou attentes locales absents de ce poste — normal, ces fichiers (données personnelles) ne sont jamais commités.');
    return;
  }
  const expectations: Expectation[] = JSON.parse(readFileSync(EXPECTED, 'utf-8'));
  const files = readdirSync(DIR).filter(f => f.endsWith('.eml'));
  console.log(`${files.length} fichiers .eml, ${expectations.length} jeux d'attentes.\n`);

  const results: ParsedEmail[] = [];
  const matched = new Set<Expectation>();

  for (const file of files) {
    const eml = decodeEml(readFileSync(join(DIR, file), 'latin1'));
    const p = parseEmail({ from: eml.from, subject: eml.subject, text: eml.text, html: eml.html });
    results.push(p);
    const exp = expectations.find(e => new RegExp(e.key).test(file));
    console.log(`— ${exp ? exp.label : `(sans attentes) ${file}`}`);
    if (exp) { matched.add(exp); runExpectation(exp, p); }
    else { failed++; console.error(`  ✘ aucun jeu d'attentes ne matche ce fichier`); }
  }

  for (const e of expectations) {
    if (!matched.has(e)) { failed++; console.error(`✘ attente jamais exercée : ${e.label}`); }
  }

  // Récapitulatif façon « file de validation » (console locale uniquement).
  console.log('\n=== File triée par score (ce que verrait l\'écran de validation) ===');
  for (const p of [...results].sort((a, b) => b.score - a.score)) {
    const name = `${p.extracted.firstName} ${p.extracted.lastName}`.trim() || '(sans nom)';
    const lvl = p.score >= 70 ? 'PROSPECT ' : p.score >= 40 ? 'À VÉRIFIER' : 'PARASITE ';
    console.log(`${String(p.score).padStart(3)} ${lvl} ${p.sourceLabel.padEnd(20)} ${name.padEnd(28)} ${p.extracted.boatInterest || '—'}`);
  }

  console.log(`\n${passed} OK, ${failed} KO`);
  if (failed > 0) process.exit(1);
}

main();
