/**
 * LOT SALONS — RATTRAPAGE DU STATUT DE CAMPAGNE des participations DÉJÀ CRÉÉES.
 *
 * POURQUOI CE SCRIPT EXISTE : le correctif du 19/09 déduit le statut de campagne
 * du statut du lead, mais il ne vaut que pour l'AVENIR. Les participations
 * créées avant lui gardent « À contacter » alors que leurs leads ont avancé —
 * sans cette passe, l'équipe déploierait un correctif et verrait exactement le
 * même écran qu'hier.
 *
 * Exécution (cible TOUJOURS explicite, verrou habituel — scripts/lib/dbTarget) :
 *   à blanc, prod    : npx tsx scripts/rattrapage-statut-campagne-turso.ts --target=prod
 *   écriture, prod   : BOB_CONFIRM_PROD=bob-brestoceanboat npx tsx scripts/rattrapage-statut-campagne-turso.ts --target=prod --apply
 *   à blanc, locale  : npx tsx scripts/rattrapage-statut-campagne-turso.ts --target=local --db=<fichier>
 *
 * CE QU'IL TOUCHE, ET RIEN D'AUTRE — quatre conditions cumulatives :
 *   1. la participation est encore à la valeur PAR DÉFAUT « À contacter »
 *      (une ligne dont quelqu'un a changé le statut n'est JAMAIS réécrite) ;
 *   2. sa campagne est ACTIVE ;
 *   3. le statut du lead donne un statut de campagne (mapping partagé avec
 *      l'application — src/lib/campagnes, une seule vérité) : Signé, Perdu,
 *      Nouveau et À contacter ne proposent rien ;
 *   4. le lead a été modifié APRÈS son entrée dans la campagne
 *      (leads.updatedAt > campagne_leads.createdAt).
 *
 * LA CONDITION 4 EST LE POINT DÉLICAT, et elle est imparfaite : `updatedAt`
 * bouge pour d'autres raisons qu'un changement de statut (une note, un
 * téléphone corrigé). Elle est CONSERVATRICE dans le bon sens — elle écarte les
 * leads déjà avancés AVANT leur entrée, qui sont l'essentiel du risque : sur la
 * grille du salon, 132 des 208 prospects actifs sont déjà « Contacté », et les
 * rattraper afficherait « Contactés : 132 sur 157 » avant le premier appel.
 * Elle peut en revanche proposer une ligne dont seul un détail a changé.
 * C'est pourquoi l'échantillon à blanc montre les DEUX dates : la vérification
 * finale est humaine, et en cas de doute on ne rattrape rien (trois
 * participations se corrigent à la main en deux minutes).
 *
 * --apply :
 *  1. SAUVEGARDE intégrée (scripts/backup-turso.ts, même cible) — arrêt si échec ;
 *  2. empreinte de TOUTES les colonnes de campagne_leads sauf `statutCampagne` ;
 *  3. les UPDATE, en UNE transaction, chacun regardé par
 *     `WHERE statutCampagne = 'À contacter'` (si la ligne a bougé entre-temps,
 *     elle n'est pas écrasée) ;
 *  4. preuve : même nombre de participations, aucun autre champ modifié ligne à
 *     ligne, répartition obtenue = répartition prévue, aucun lead touché ;
 *  5. rejeu : 0 ligne (les lignes corrigées ne sont plus « À contacter »).
 *
 * Ce script ne touche JAMAIS à `leads` : le statut du lead est la vérité, le
 * statut de campagne en dérive — jamais l'inverse.
 */
import { createClient, type Client } from '@libsql/client';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { guardDbTarget } from './lib/dbTarget';
import { fingerprint } from './apply-planned-actions-turso';
import { statutCampagneDepuisLead } from '../src/lib/campagnes';
import type { CampagneStatut, LeadStatus } from '../src/data/types';
import { getStatusLabel } from '../src/data/constants';

/** Valeur par défaut de la colonne : la seule que ce script accepte de corriger. */
export const STATUT_PAR_DEFAUT = 'À contacter';

/** Une participation telle que la base la donne (jointe à son lead et à sa campagne). */
export interface LigneBrute {
  id: string;
  leadId: string;
  nom: string;
  statutLead: string;
  statutCampagne: string;
  campagneNom: string;
  campagneActive: boolean;
  /** Valeurs BRUTES : SQLite peut rendre un entier (ms) ou du texte, selon l'écrivain. */
  leadUpdatedAt: unknown;
  participationCreatedAt: unknown;
}

export interface Proposition {
  id: string;
  nom: string;
  statutLead: string;
  statutCampagne: string;
  cible: CampagneStatut;
  campagneNom: string;
  leadModifieLe: number;
  entreLe: number;
}

/** Motifs d'écartement — affichés à blanc, pour qu'aucune ligne ne disparaisse en silence. */
export type Motif =
  | 'statut déjà modifié (jamais réécrit)'
  | 'campagne archivée'
  | 'statut du lead sans effet (Signé, Perdu, Nouveau, À contacter)'
  | 'lead inchangé depuis son entrée dans la campagne'
  | 'dates illisibles (prudence : on ne propose pas)';

export interface PlanRattrapage {
  aCorriger: Proposition[];
  ecartees: { motif: Motif; n: number }[];
  /** Répartition attendue APRÈS écriture, par statut cible. */
  attendu: Map<string, number>;
}

/**
 * Horodatage en millisecondes, quelle que soit la façon dont la valeur a été
 * écrite. Les deux écrivains de cette base ne s'accordent pas :
 *  - Prisma écrit un DateTime SQLite en ENTIER (ms depuis epoch) ;
 *  - la migration écrite à la main utilise CURRENT_TIMESTAMP, qui rend du TEXTE
 *    « YYYY-MM-DD HH:MM:SS » en UTC (sans fuseau : sans le « Z », JavaScript le
 *    lirait en heure locale et décalerait la comparaison de deux heures l'été).
 * Renvoie null si la valeur est inutilisable — on n'invente pas une date.
 */
export function msDepuis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  // « 2026-09-18 19:04:12 » (CURRENT_TIMESTAMP) : UTC, il faut le dire.
  const sqlite = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(t);
  const iso = sqlite ? `${sqlite[1]}T${sqlite[2]}${sqlite[3] ?? ''}Z` : t;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Plan PUR : ce qui serait écrit, et ce qui est écarté, avec le motif. */
export function planRattrapage(lignes: LigneBrute[]): PlanRattrapage {
  const aCorriger: Proposition[] = [];
  const motifs = new Map<Motif, number>();
  const compter = (m: Motif) => motifs.set(m, (motifs.get(m) ?? 0) + 1);

  for (const l of lignes) {
    if (l.statutCampagne !== STATUT_PAR_DEFAUT) { compter('statut déjà modifié (jamais réécrit)'); continue; }
    if (!l.campagneActive) { compter('campagne archivée'); continue; }
    const cible = statutCampagneDepuisLead(l.statutLead as LeadStatus);
    if (!cible || cible === STATUT_PAR_DEFAUT) { compter('statut du lead sans effet (Signé, Perdu, Nouveau, À contacter)'); continue; }
    const leadModifieLe = msDepuis(l.leadUpdatedAt);
    const entreLe = msDepuis(l.participationCreatedAt);
    if (leadModifieLe === null || entreLe === null) { compter('dates illisibles (prudence : on ne propose pas)'); continue; }
    // LA FRONTIÈRE : seuls les changements SURVENUS APRÈS l'entrée comptent.
    if (leadModifieLe <= entreLe) { compter('lead inchangé depuis son entrée dans la campagne'); continue; }
    aCorriger.push({
      id: l.id, nom: l.nom, statutLead: l.statutLead, statutCampagne: l.statutCampagne,
      cible, campagneNom: l.campagneNom, leadModifieLe, entreLe,
    });
  }

  const attendu = new Map<string, number>();
  for (const p of aCorriger) attendu.set(p.cible, (attendu.get(p.cible) ?? 0) + 1);
  // Les plus récemment travaillés d'abord : ce sont les plus faciles à
  // reconnaître pour la vérification humaine.
  aCorriger.sort((a, b) => b.leadModifieLe - a.leadModifieLe || a.nom.localeCompare(b.nom));
  return { aCorriger, ecartees: [...motifs].map(([motif, n]) => ({ motif, n })), attendu };
}

/** Les participations, jointes à leur lead et à leur campagne. Lecture seule. */
export async function lireLignes(db: Client): Promise<LigneBrute[]> {
  const sql = `
    SELECT p.id AS id, p.leadId AS leadId, p.statutCampagne AS statutCampagne, p.createdAt AS participationCreatedAt,
           l.firstName AS firstName, l.lastName AS lastName, l.status AS statutLead, l.updatedAt AS leadUpdatedAt,
           c.nom AS campagneNom, c.active AS campagneActive
    FROM campagne_leads p
    JOIN leads l ON l.id = p.leadId
    JOIN campagnes c ON c.id = p.campagneId
    ORDER BY p.id`;
  return (await db.execute(sql)).rows.map(r => ({
    id: String(r.id),
    leadId: String(r.leadId),
    nom: `${String(r.firstName ?? '')} ${String(r.lastName ?? '')}`.trim(),
    statutLead: String(r.statutLead),
    statutCampagne: String(r.statutCampagne),
    campagneNom: String(r.campagneNom),
    campagneActive: !!Number(r.campagneActive),
    leadUpdatedAt: r.leadUpdatedAt,
    participationCreatedAt: r.participationCreatedAt,
  }));
}

/** Colonnes de campagne_leads SAUF `statutCampagne` (lues dans la base). */
export async function colonnesHorsStatut(db: Client): Promise<string[]> {
  return (await db.execute(`SELECT name FROM pragma_table_info('campagne_leads') ORDER BY cid`)).rows
    .map(r => String(r.name))
    .filter(c => c !== 'statutCampagne' && c !== 'updatedAt'); // updatedAt bouge par construction
}

/**
 * Écrit les corrections en UNE transaction. Le `WHERE statutCampagne = 'À
 * contacter'` est un garde-fou et non une redite : entre la lecture et
 * l'écriture, quelqu'un a pu poser un statut à la main — sa valeur gagne.
 */
export async function appliquerRattrapage(db: Client, propositions: Proposition[]): Promise<number> {
  if (propositions.length === 0) return 0;
  const tx = await db.transaction('write');
  try {
    let n = 0;
    for (const p of propositions) {
      n += (await tx.execute({
        sql: `UPDATE campagne_leads SET statutCampagne = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND statutCampagne = ?`,
        args: [p.cible, p.id, STATUT_PAR_DEFAUT],
      })).rowsAffected;
    }
    await tx.commit();
    return n;
  } catch (e) {
    await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
}

type Fp = { count: number; sha256: string };

export async function prouverRattrapage(
  db: Client,
  avant: { autres: Fp; colonnes: string[]; leads: Fp; colonnesLeads: string[] },
  prevu: Proposition[],
): Promise<{ label: string; ok: boolean; detail?: string }[]> {
  const checks: { label: string; ok: boolean; detail?: string }[] = [];
  const autres = await fingerprint(db, 'campagne_leads', avant.colonnes);
  checks.push({ label: `participations : même nombre (${avant.autres.count})`, ok: autres.count === avant.autres.count, detail: String(autres.count) });
  checks.push({ label: `aucun autre champ de la participation modifié (${avant.colonnes.length} colonnes, ligne à ligne)`, ok: autres.sha256 === avant.autres.sha256 });

  // LA règle d'or : rien ne remonte vers les leads.
  const leads = await fingerprint(db, 'leads', avant.colonnesLeads);
  checks.push({ label: `AUCUN LEAD TOUCHÉ (${avant.colonnesLeads.length} colonnes, ligne à ligne)`, ok: leads.sha256 === avant.leads.sha256 && leads.count === avant.leads.count });

  // Ligne à ligne : chaque participation prévue porte EXACTEMENT le statut prévu.
  const apresLignes = await lireLignes(db);
  const parId = new Map(apresLignes.map(l => [l.id, l.statutCampagne]));
  const faux = prevu.filter(p => parId.get(p.id) !== p.cible);
  checks.push({ label: `chaque participation prévue porte le statut prévu (${prevu.length} lignes)`, ok: faux.length === 0, detail: faux.slice(0, 3).map(f => `${f.nom} : ${parId.get(f.id)} ≠ ${f.cible}`).join(' ; ') });

  // Aucune AUTRE ligne n'a bougé : celles qui n'étaient pas prévues et qui
  // étaient à « À contacter » y sont encore.
  const prevus = new Set(prevu.map(p => p.id));
  const intactes = apresLignes.filter(l => !prevus.has(l.id) && l.statutCampagne !== STATUT_PAR_DEFAUT).length;
  const attendusIntacts = avant.autres.count - prevu.length;
  checks.push({ label: 'aucune ligne hors plan n\'a été réécrite', ok: apresLignes.filter(l => !prevus.has(l.id)).length === attendusIntacts, detail: `${intactes} hors plan portent déjà un statut posé à la main` });

  checks.push({ label: 'plus aucune ligne à rattraper (le plan rejoué est vide)', ok: planRattrapage(apresLignes).aCorriger.length === 0 });
  const reparti = (await db.execute(`SELECT statutCampagne, COUNT(*) AS n FROM campagne_leads GROUP BY statutCampagne ORDER BY n DESC`)).rows
    .map(r => `${String(r.statutCampagne)} ${Number(r.n)}`).join(', ');
  checks.push({ label: 'répartition obtenue', ok: true, detail: reparti });
  return checks;
}

const dt = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

async function main() {
  const guard = guardDbTarget({ scriptName: 'rattrapage-statut-campagne-turso', write: true });
  if (!guard) process.exit(1);
  const { target, apply } = guard;
  const t0 = Date.now();
  const db = createClient(target.kind === 'prod' ? { url: target.url, authToken: target.authToken } : { url: target.url });

  const lignes = await lireLignes(db);
  const plan = planRattrapage(lignes);
  const parDefaut = lignes.filter(l => l.statutCampagne === STATUT_PAR_DEFAUT).length;

  console.log(`\nParticipations : ${lignes.length} · encore à « ${STATUT_PAR_DEFAUT} » : ${parDefaut}`);
  console.log(`À rattraper : ${plan.aCorriger.length}`);
  if (plan.ecartees.length) {
    console.log('\nÉcartées (et pourquoi) :');
    for (const e of [...plan.ecartees].sort((a, b) => b.n - a.n)) console.log(`  ${String(e.n).padStart(4)}  ${e.motif}`);
  }
  if (plan.attendu.size) {
    console.log('\nStatuts qui seraient posés :');
    for (const [statut, n] of [...plan.attendu].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${statut}`);
  }

  if (plan.aCorriger.length) {
    // ÉCHANTILLON À VÉRIFIER À LA MAIN : les deux dates sont là exprès. Si des
    // lignes n'ont manifestement pas été travaillées depuis l'ajout, on ne
    // rattrape rien et l'équipe corrige à la main.
    const n = Math.min(20, plan.aCorriger.length);
    console.log(`\nÉchantillon (${n} sur ${plan.aCorriger.length}, lead modifié le plus récemment d'abord) :`);
    console.log(`  ${'Nom'.padEnd(26)}${'Statut du lead'.padEnd(16)}${'Campagne : actuel'.padEnd(20)}${'-> proposé'.padEnd(24)}${'lead modifié'.padEnd(19)}entré dans la campagne`);
    for (const p of plan.aCorriger.slice(0, n)) {
      console.log(`  ${p.nom.slice(0, 25).padEnd(26)}${getStatusLabel(p.statutLead as LeadStatus).padEnd(16)}${p.statutCampagne.padEnd(20)}${`-> ${p.cible}`.padEnd(24)}${dt(p.leadModifieLe).padEnd(19)}${dt(p.entreLe)}`);
    }
  }

  if (!apply) {
    console.log(`\nÀ blanc : rien n'a été écrit, aucune sauvegarde prise. Relancer avec --apply (et, en prod, BOB_CONFIRM_PROD).`);
    db.close();
    return;
  }
  if (plan.aCorriger.length === 0) { console.log('\nRien à rattraper (rejeu) : aucune écriture.'); db.close(); return; }

  // 1) Sauvegarde intégrée, même cible.
  console.log('\n— Sauvegarde avant rattrapage —');
  const args = ['tsx', 'scripts/backup-turso.ts', `--target=${target.kind}`, ...(target.kind === 'local' ? [`--db=${target.path}`] : [])];
  const env = { ...process.env, ...(target.kind === 'local' && !process.env.BACKUP_DIR ? { BACKUP_DIR: path.join(path.dirname(target.path), 'sauvegardes-locales') } : {}) };
  const backup = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32', env });
  if (backup.status !== 0) { console.error('\n❌ Sauvegarde en échec : rattrapage NON appliqué.'); db.close(); process.exit(1); }

  // 2-4) Empreintes, écriture, preuve.
  const colonnes = await colonnesHorsStatut(db);
  const colonnesLeads = (await db.execute(`SELECT name FROM pragma_table_info('leads') ORDER BY cid`)).rows.map(r => String(r.name));
  const avant = {
    autres: await fingerprint(db, 'campagne_leads', colonnes), colonnes,
    leads: await fingerprint(db, 'leads', colonnesLeads), colonnesLeads,
  };
  const tWrite = Date.now();
  const n = await appliquerRattrapage(db, plan.aCorriger);
  const writeMs = Date.now() - tWrite;
  const checks = await prouverRattrapage(db, avant, plan.aCorriger);
  const rejeu = await appliquerRattrapage(db, planRattrapage(await lireLignes(db)).aCorriger);
  checks.push({ label: 'rejeu : 0 ligne modifiée', ok: rejeu === 0, detail: String(rejeu) });
  db.close();

  console.log(`\nRattrapage : ${n} participation(s) corrigée(s) sur ${plan.aCorriger.length} prévue(s) · écriture ${writeMs} ms · total ${Date.now() - t0} ms`);
  console.log('\n— Preuve —');
  for (const c of checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.label}${c.detail ? ` (${c.detail})` : ''}`);
  if (checks.some(c => !c.ok)) { console.error('\n❌ Preuve en échec : restaurer la sauvegarde prise ci-dessus.'); process.exit(1); }
  console.log('\n✅ Rattrapage appliqué et prouvé.');
}

if (process.argv[1]?.includes('rattrapage-statut-campagne-turso')) {
  main().catch(e => { console.error('Échec :', e); process.exit(1); });
}
