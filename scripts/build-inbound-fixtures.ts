/**
 * Générateur de fixtures RÉELLES pour la maquette « Boîte de réception
 * prospects » (chantier import email, point D).
 *
 * Exécution : npx tsx scripts/build-inbound-fixtures.ts
 *
 * Lit les .eml locaux de docs/emails-echantillon (VRAIES données de
 * prospects, dossier gitignoré), les passe dans parseEmail (le « cerveau »
 * testé au harnais) et écrit src/data/inboundFixtures.local.json — GITIGNORÉ
 * LUI AUSSI (mêmes données perso). InboundDemoProvider charge ce JSON s'il
 * existe (import.meta.glob), sinon retombe sur les fixtures fictives : la
 * démo fidèle n'existe que sur les postes qui possèdent l'échantillon.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeEml } from './emlDecode';
import { parseEmail } from '../src/lib/email/parseEmail';
import { unwrapForwards } from '../src/lib/email/forward';
import { htmlToText } from '../src/lib/email/htmlToText';
import type { InboundEmail } from '../src/data/types';

const SRC = join(import.meta.dirname, '..', 'docs', 'emails-echantillon');
const OUT = join(import.meta.dirname, '..', 'src', 'data', 'inboundFixtures.local.json');

/** "Thu, 2 Jul 2026 11:57:43 +0000" -> "2026-07-02 11:57" (heure locale). */
function toReceivedAt(rfcDate: string): string {
  const d = new Date(rfcDate);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function slug(fileName: string): string {
  return 'eml-' + fileName
    .replace(/\.eml$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
}

function main() {
  if (!existsSync(SRC)) {
    console.error(`Dossier ${SRC} absent : ce script ne peut tourner que sur un poste possédant l'échantillon .eml.`);
    process.exit(1);
  }
  const files = readdirSync(SRC).filter(f => f.endsWith('.eml'));
  const fixtures: InboundEmail[] = files.map(file => {
    const eml = decodeEml(readFileSync(join(SRC, file), 'latin1'));
    const text = eml.text.trim() ? eml.text : htmlToText(eml.html);
    const p = parseEmail({ from: eml.from, subject: eml.subject, text: eml.text, html: eml.html });
    // L'enveloppe déballée fournit l'expéditeur et l'objet ORIGINAUX pour
    // l'affichage de la carte (parseEmail ne renvoie que l'analyse).
    const env = unwrapForwards(eml.from, eml.subject, text);
    return {
      id: slug(file),
      receivedAt: toReceivedAt(eml.date),
      fromAddress: env.fromAddress,
      subject: env.subject,
      // Notes (LeadSmart, Ref Infocob, consentement, fil, adresse) accolées à
      // l'extrait : visibles sur la carte ET versées aux commentaires du lead.
      excerpt: [p.excerpt, ...p.notes].filter(Boolean).join('\n\n'),
      sourceLabel: p.sourceLabel,
      sourceDetail: p.sourceDetail,
      leadSource: p.leadSource,
      score: p.score,
      scoreReasons: p.scoreReasons,
      extracted: p.extracted,
      status: 'a_traiter',
    };
  });

  writeFileSync(OUT, JSON.stringify(fixtures, null, 2), 'utf-8');
  console.log(`${fixtures.length} emails analysés -> ${OUT}`);
  console.log('RAPPEL RGPD : fichier de données personnelles, gitignoré, à ne jamais commiter ni diffuser.');
}

main();
