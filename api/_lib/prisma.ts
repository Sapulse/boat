import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';

// Factory Prisma (chantier migration, Lot 4) — le PORTIER serveur.
//
// L'app ne parle JAMAIS directement à Turso : elle passe par l'API, qui seule
// détient le client Prisma et le secret Turso. Adaptateur libSQL pour les DEUX
// modes (un seul adaptateur, pas de module natif) :
//  - prod / Vercel : Turso (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN, région UE) ;
//  - local / dev   : fichier ./dev.db (même schéma que le Lot 1).
// Même pattern que SAForm (save saforme/src/lib/prisma.ts), simplifié à libSQL
// (qui gère aussi le mode fichier -> pas de better-sqlite3).
function createPrismaClient(): PrismaClient {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const adapter = url && authToken
    ? new PrismaLibSql({ url, authToken })
    : new PrismaLibSql({ url: process.env.DATABASE_URL ?? 'file:./dev.db' });
  return new PrismaClient({ adapter });
}

// Singleton (réutilisé entre invocations chaudes d'une même fonction Vercel).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
