import { useState, type ReactNode } from 'react';
import { InboundDemoContext } from './useInboundDemo';
import type { InboundEmail, InboundExtracted } from '../data/types';
import { MOCK_INBOUND_EMAILS } from '../data/mockInboundEmails';

// Store de la maquette « Boîte de réception prospects » (Étape A) : fixtures EN
// MÉMOIRE, volontairement hors AppState / localStorage — recharger la page
// réinitialise la démo (rejouable à volonté). Seuls les leads ACCEPTÉS entrent
// dans le CRM, par le addLead normal (appelé côté page). À l'Étape B, ce
// provider sera remplacé par la vraie file (table inbound_emails via l'API)
// sans changer les consommateurs (page + badge du menu).

// Fixtures RÉELLES si présentes (point D) : inboundFixtures.local.json est
// généré LOCALEMENT par scripts/build-inbound-fixtures.ts depuis les .eml de
// l'échantillon — fichier GITIGNORÉ (données perso), absent des autres postes.
// Garde RGPD : le glob n'existe qu'en DEV (serveur vite). En BUILD de prod,
// import.meta.env.DEV est remplacé par false -> branche morte éliminée, le
// JSON n'est JAMAIS inliné dans dist/ même s'il est présent sur le poste
// (prouvé au harnais de build : grep des données réelles sur dist = vide).
// Double filet : .vercelignore exclut aussi le JSON et les .eml.
const realModules = import.meta.env.DEV
  ? import.meta.glob('../data/inboundFixtures.local.json', { eager: true }) as
    Record<string, { default: InboundEmail[] }>
  : {};
const REAL_FIXTURES = Object.values(realModules)[0]?.default;
const INITIAL_EMAILS = REAL_FIXTURES ?? MOCK_INBOUND_EMAILS;
/** true = la démo tourne sur les vrais emails analysés (bandeau adapté). */
const REAL_DATA = REAL_FIXTURES !== undefined;

export function InboundDemoProvider({ children }: { children: ReactNode }) {
  const [emails, setEmails] = useState(INITIAL_EMAILS);

  const updateExtracted = (id: string, patch: Partial<InboundExtracted>) =>
    setEmails(prev => prev.map(m => (m.id === id ? { ...m, extracted: { ...m.extracted, ...patch } } : m)));

  // Transitions à sens unique depuis 'a_traiter' : un email déjà traité ne
  // change plus (protège d'un double-clic — le addLead, lui, est gardé côté page).
  const accept = (id: string, leadId: string) =>
    setEmails(prev => prev.map(m => (m.id === id && m.status === 'a_traiter' ? { ...m, status: 'accepte', leadId } : m)));

  const reject = (id: string) =>
    setEmails(prev => prev.map(m => (m.id === id && m.status === 'a_traiter' ? { ...m, status: 'rejete' } : m)));

  const pendingCount = emails.filter(m => m.status === 'a_traiter').length;

  return (
    <InboundDemoContext.Provider value={{ emails, pendingCount, realData: REAL_DATA, updateExtracted, accept, reject }}>
      {children}
    </InboundDemoContext.Provider>
  );
}
