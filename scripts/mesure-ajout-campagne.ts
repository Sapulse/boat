/**
 * LOT SALONS — MESURE de l'ajout en masse (pas un harnais : un chronomètre).
 *
 * Exécution : npx tsx scripts/mesure-ajout-campagne.ts [nombre]
 *
 * Pourquoi : la démonstration à l'équipe EST le peuplement de la campagne.
 * Nicolas et Frédéric vont cocher 150 à 250 leads d'un coup, en séance. Un
 * `create` par ligne coûterait un aller-retour réseau par ligne ; on mesure donc
 * ce que coûte VRAIMENT l'écriture groupée, sur une base jetable de la taille de
 * la prod (443 leads).
 *
 * Cible : moins de 3 secondes perçues pour 250 participations.
 */
import { createClient } from '@libsql/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { readFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { addCampagneLeads, getState, createCommercial } from '../api/_lib/store';
import { preparerAjout } from '../src/lib/campagnes';
import type { AppState } from '../src/data/types';

const COMBIEN = Number(process.argv[2] ?? 250);
const LEADS = Math.max(443, COMBIEN);
const DB_FILE = path.resolve('.mesure-campagne.db');
const DB_URL = `file:${DB_FILE}`;

function migrationSql(): string {
  const dir = path.resolve('prisma/migrations');
  return readdirSync(dir).filter(d => !d.endsWith('.toml')).sort()
    .map(d => readFileSync(path.join(dir, d, 'migration.sql'), 'utf-8')).join('\n');
}

async function main() {
  console.log(`\nMesure : ajout de ${COMBIEN} participations, sur une base de ${LEADS} leads (taille de la prod).`);
  rmSync(DB_FILE, { force: true });
  const setup = createClient({ url: DB_URL });
  await setup.executeMultiple('PRAGMA foreign_keys = ON;\n' + migrationSql());
  await setup.close();
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: DB_URL }) });

  await createCommercial(prisma, { id: 'nicolas', name: 'Nicolas', active: true });
  const t0 = Date.now();
  await prisma.lead.createMany({
    data: Array.from({ length: LEADS }, (_, i) => ({
      id: `lead-${i}`, createdAt: '2026-09-01', source: 'LBC', commercialId: 'nicolas',
      firstName: 'Test', lastName: `Lead ${i}`, phone: '', email: '', boatType: '', boatCondition: '',
      boatInterest: '', brand: '', budget: null, status: 'contacte', contactDate: '', quoteAmount: null,
      probability: null, currentBoat: '', comments: '', deliveryDate: '', temperature: 'tiede',
      priority: 'normale', nextActionType: '', nextActionDate: '', lastActionDate: '',
      lossReason: '', signedAt: '', lostAt: '', reportedAt: '', noNextActionReason: '', noNextActionAt: '',
    })),
  });
  console.log(`  base prête (${LEADS} leads) en ${Date.now() - t0} ms`);

  const etat: AppState = await getState(prisma);
  const campagneId = etat.campagnes![0].id;

  // 1) Préparation côté client (module pur) : ce que fait l'écran avant d'envoyer.
  const tPrep = Date.now();
  const { nouvelles } = preparerAjout(etat, {
    campagneId, leadIds: etat.leads.slice(0, COMBIEN).map(l => l.id),
    segment: 'Emailing Grand Pavois', priorite: 'Haute', responsableId: 'nicolas',
    statutParDefaut: 'À contacter',
  }, () => crypto.randomUUID());
  const msPrep = Date.now() - tPrep;

  // 2) Écriture serveur : LE chiffre qui compte.
  const tEcriture = Date.now();
  const r = await addCampagneLeads(prisma, nouvelles);
  const msEcriture = Date.now() - tEcriture;

  // 3) Rechargement de l'état (ce que l'écran refait après l'ajout).
  const tRelecture = Date.now();
  const apres = await getState(prisma);
  const msRelecture = Date.now() - tRelecture;

  // 4) Deuxième passage : tout est déjà là -> aucune écriture, juste la détection.
  const tRejeu = Date.now();
  const rejeu = await addCampagneLeads(prisma, nouvelles);
  const msRejeu = Date.now() - tRejeu;

  await prisma.$disconnect();
  // Ménage tolérant (verrou Windows sur un fichier tout juste fermé).
  try { rmSync(DB_FILE, { force: true }); } catch { /* ignore */ }

  const total = msPrep + msEcriture + msRelecture;
  console.log('\n— Temps mesurés —');
  console.log(`  préparation (client, module pur) : ${msPrep} ms`);
  console.log(`  écriture serveur (${r.ajoutes.length} participations) : ${msEcriture} ms`);
  console.log(`  relecture de l'état complet      : ${msRelecture} ms`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  TOTAL perçu par l'utilisateur     : ${total} ms`);
  console.log(`  rejeu (tout déjà participant)     : ${msRejeu} ms (${rejeu.ajoutes.length} ajoutée(s), ${rejeu.ignores.length} ignorée(s))`);
  console.log(`\n  participations en base : ${apres.campagneLeads?.length}`);
  const cible = total < 3000;
  console.log(`\n${cible ? '✅' : '❌'} Cible « moins de 3 s perçues » : ${cible ? 'tenue' : 'NON TENUE'} (${(total / 1000).toFixed(2)} s)`);
  console.log('   ⚠️  Base LOCALE : en prod chaque aller-retour passe par le réseau (Turso).');
  console.log('   C\'est justement pourquoi l\'écriture est GROUPÉE : 2 requêtes, pas une par ligne.');
  if (!cible) process.exit(1);
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
