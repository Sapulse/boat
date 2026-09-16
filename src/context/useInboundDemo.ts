import { createContext, useContext } from 'react';
import type { InboundEmail, InboundExtracted } from '../data/types';
import type { ProcessedPage, ProcessedStatusFilter } from '../lib/inbound';

// Contexte + hook de la Boîte de réception prospects. Module sans composant
// (règle react-refresh) — le provider vit dans InboundDemoContext.tsx.
//
// DEUX implémentations derrière le MÊME contrat (couture façon repository) :
//  - flag off (localStorage) : démo en mémoire (fixtures fictives, ou JSON réel
//    local en dev) — accept crée le lead via addLead côté client ;
//  - flag on (USE_API) : la vraie file serveur (table inbound_emails) — accept
//    et reject passent par l'API, la collecte se déclenche par collectNow().

/** Rapport de collecte renvoyé par POST /api/inbound-collect. */
export interface CollectSummary {
  windowSince: string;
  scanned: number;
  inserted: number;
  alreadySeen: number;
  autoRejected: number;
  truncated: boolean;
  errors: string[];
}

export interface InboundContextType {
  emails: InboundEmail[];
  /** Nombre d'emails « à traiter » — alimente le badge du menu. */
  pendingCount: number;
  /** Démo : fixtures RÉELLES locales chargées (bandeau adapté). */
  realData: boolean;
  /** true = branché sur la vraie file serveur (mode API). */
  apiMode: boolean;
  /** Collecte en cours (verrouille le bouton Importer). */
  collecting: boolean;
  /** Déclenchement MANUEL de la collecte — mode API uniquement (undefined en démo). */
  collectNow?: () => Promise<CollectSummary>;
  /** Corrige un champ extrait avant acceptation (édition locale, envoyée à l'accept). */
  updateExtracted(id: string, patch: Partial<InboundExtracted>): void;
  /** Accepte : crée le lead (client en démo, serveur en API) — résout l'id du lead créé. */
  accept(mail: InboundEmail, commercialId: string): Promise<string>;
  reject(id: string): Promise<void>;
  /**
   * RATTACHE la demande à un lead EXISTANT : aucun lead créé, une action
   * d'historique ajoutée au lead visé — et rien d'autre (le lead n'est pas
   * modifié). La troisième issue qui manquait quand un doublon est détecté.
   */
  attach(mail: InboundEmail, leadId: string): Promise<void>;
  /** Remet en file un email REJETÉ (le seul statut réversible). */
  reopen(id: string): Promise<void>;
  /**
   * Page de « Traités » filtrée (statut + recherche). Serveur en mode API, calcul
   * local en démo — même sémantique (filterProcessedInbound).
   */
  listProcessed(params: { status: ProcessedStatusFilter; q: string; offset: number; limit: number }): Promise<ProcessedPage>;
  /**
   * Incrémenté à CHAQUE changement de la file (accepter, rejeter, rattacher,
   * remettre en file, importer) : « Traités » recharge sa première page.
   */
  processedVersion: number;
}

export const InboundDemoContext = createContext<InboundContextType | null>(null);

export function useInboundDemo(): InboundContextType {
  const ctx = useContext(InboundDemoContext);
  if (!ctx) throw new Error('useInboundDemo must be used within InboundDemoProvider');
  return ctx;
}
