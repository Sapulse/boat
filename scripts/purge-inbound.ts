/**
 * Purge de rétention des emails REJETÉS — `npm run purge:inbound`.
 *
 * Politique RGPD du projet : un email de prospect qu'on a REJETÉ n'a plus de
 * raison d'être conservé au-delà de 90 jours (minimisation). Les emails
 * « à traiter » (travail en attente) et « acceptés » (qui portent le lien vers le
 * lead créé, donc la trace de l'origine d'un lead réel) ne sont JAMAIS touchés.
 *
 * ⚠️ SEUL DELETE de tout le pipeline d'import. Donc, par construction :
 *  - le mode À BLANC est le DÉFAUT : sans `--apply`, rien n'est supprimé, on
 *    affiche seulement ce qui partirait ;
 *  - `--apply` est explicite et volontaire ;
 *  - à lancer APRÈS `npm run backup` : le dump contient inbound_emails, donc une
 *    purge trop enthousiaste reste rattrapable.
 *
 * Exécution (cible explicite, voir scripts/lib/dbTarget) :
 *   à blanc  : npm run purge:inbound -- --target=prod
 *   écriture : BOB_CONFIRM_PROD=<base> npm run purge:inbound -- --target=prod --apply
 * Plus de lecture automatique de .env : sans --target, refus.
 */
import { guardDbTarget, applyTargetToProcessEnv } from './lib/dbTarget';
import {
  INBOUND_RETENTION_DAYS, inboundRetentionCutoff,
  listPurgeableInbound, purgeRejectedInbound,
} from '../api/_lib/inboundStore';

/** Masque une adresse pour l'affichage terminal : j***@domaine.fr */
function maskEmail(a: string): string {
  const [user, domain] = a.split('@');
  if (!domain) return a.slice(0, 2) + '***';
  return `${user.slice(0, 1)}***@${domain}`;
}

async function main() {
  const guard = guardDbTarget({ scriptName: 'purge-inbound', write: true });
  if (!guard) process.exit(1);
  const { target, apply } = guard;
  // Le client Prisma partagé lit l'environnement À L'IMPORT : on y pose la cible
  // résolue, et SEULEMENT elle, avant de l'importer.
  applyTargetToProcessEnv(target);

  const { prisma } = await import('../api/_lib/prisma');
  const now = new Date();
  const cutoff = inboundRetentionCutoff(now);
  console.log(`Règle  : emails REJETÉS depuis plus de ${INBOUND_RETENTION_DAYS} j`);
  console.log(`Borne  : rejetés avant le ${cutoff.toISOString().slice(0, 10)}\n`);

  const rows = await listPurgeableInbound(prisma, cutoff);
  const total = await prisma.inboundEmail.count();
  const byStatus = await prisma.inboundEmail.groupBy({ by: ['status'], _count: { _all: true } });

  console.log(`File d'import : ${total} email(s) — ${byStatus.map(s => `${s.status}: ${s._count._all}`).join(', ')}`);
  console.log(`Hors délai (rejetés) : ${rows.length}\n`);

  if (rows.length === 0) {
    console.log('Rien à purger. La politique de rétention est déjà respectée. ✅');
    await prisma.$disconnect();
    return;
  }

  for (const r of rows) {
    console.log(`  - ${r.updatedAt.toISOString().slice(0, 10)}  ${maskEmail(r.fromAddress).padEnd(28)} ${r.subject.slice(0, 50)}`);
  }

  if (!apply) {
    console.log(`\nÀ blanc : RIEN n'a été supprimé.`);
    console.log('Pour appliquer (après `npm run backup:prod`) : BOB_CONFIRM_PROD=<base> npm run purge:inbound -- --target=prod --apply');
    await prisma.$disconnect();
    return;
  }

  const deleted = await purgeRejectedInbound(prisma, cutoff);
  const after = await prisma.inboundEmail.count();
  await prisma.$disconnect();
  console.log(`\n✅ ${deleted} email(s) rejeté(s) supprimé(s). File : ${total} -> ${after}.`);
  console.log("   Aucun lead touché (la purge ne porte que sur inbound_emails au statut 'rejete').");
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
