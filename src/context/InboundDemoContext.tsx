import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { InboundDemoContext, type CollectSummary } from './useInboundDemo';
import type { InboundEmail, InboundExtracted } from '../data/types';
import { MOCK_INBOUND_EMAILS } from '../data/mockInboundEmails';
import { USE_API } from '../lib/flags';
import { useApp } from './useApp';
import { buildLeadFromInbound } from '../lib/inbound';
import { toISODate } from '../lib/utils';

// Provider de la Boîte de réception prospects — DEUX modes derrière un contrat
// unique (voir useInboundDemo.ts) :
//
//  FLAG OFF (localStorage) : démo EN MÉMOIRE, rejouable au rechargement. Seuls
//  les leads ACCEPTÉS entrent dans le CRM (addLead client). Fixtures fictives,
//  ou JSON réel local en DEV (gitignoré, jamais dans un build de prod — garde
//  import.meta.env.DEV prouvée par grep du dist).
//
//  FLAG ON (USE_API) : la VRAIE file (table inbound_emails via l'API, session
//  requise). La collecte est MANUELLE (collectNow -> POST /api/inbound-collect,
//  aucun cron). Accepter/rejeter passent par le serveur (le lead est créé côté
//  API, anti-doublon affiché côté client comme partout). Le code du mode
//  inactif est éliminé du bundle (USE_API constante de build).

const realModules = import.meta.env.DEV
  ? import.meta.glob('../data/inboundFixtures.local.json', { eager: true }) as
    Record<string, { default: InboundEmail[] }>
  : {};
const REAL_FIXTURES = Object.values(realModules)[0]?.default;
const DEMO_INITIAL = REAL_FIXTURES ?? MOCK_INBOUND_EMAILS;
const DEMO_REAL_DATA = REAL_FIXTURES !== undefined;

// Appels API (mode flag on uniquement — tree-shaké en flag off).
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';
async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json() as { error?: string }).error ?? msg; } catch { /* corps non-JSON */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function InboundDemoProvider({ children }: { children: ReactNode }) {
  const { addLead } = useApp();
  const [emails, setEmails] = useState<InboundEmail[]>(USE_API ? [] : DEMO_INITIAL);
  const [collecting, setCollecting] = useState(false);

  const refresh = useCallback(async () => {
    if (!USE_API) return;
    setEmails(await apiJson<InboundEmail[]>('/inbound'));
  }, []);

  // Mode API : charge la file au montage (échec silencieux : l'écran affichera
  // une file vide et le rechargement/bouton retentera — pas d'écran bloquant).
  useEffect(() => {
    if (!USE_API) return;
    refresh().catch(() => {});
  }, [refresh]);

  const updateExtracted = (id: string, patch: Partial<InboundExtracted>) =>
    setEmails(prev => prev.map(m => (m.id === id ? { ...m, extracted: { ...m.extracted, ...patch } } : m)));

  const accept = async (mail: InboundEmail, commercialId: string): Promise<string> => {
    if (USE_API) {
      const out = await apiJson<{ inbound: InboundEmail; lead: { id: string } }>(`/inbound/${mail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'accept', commercialId, extracted: mail.extracted }),
      });
      setEmails(prev => prev.map(m => (m.id === mail.id ? out.inbound : m)));
      return out.lead.id;
    }
    // Démo : transitions à sens unique depuis 'a_traiter' (protège du double-clic).
    if (mail.status !== 'a_traiter') return mail.leadId ?? '';
    const leadId = addLead(buildLeadFromInbound(mail, commercialId, toISODate(new Date())));
    setEmails(prev => prev.map(m => (m.id === mail.id && m.status === 'a_traiter' ? { ...m, status: 'accepte', leadId } : m)));
    return leadId;
  };

  const reject = async (id: string): Promise<void> => {
    if (USE_API) {
      const out = await apiJson<{ inbound: InboundEmail }>(`/inbound/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reject' }),
      });
      setEmails(prev => prev.map(m => (m.id === id ? out.inbound : m)));
      return;
    }
    setEmails(prev => prev.map(m => (m.id === id && m.status === 'a_traiter' ? { ...m, status: 'rejete' } : m)));
  };

  const collectNow = USE_API
    ? async (): Promise<CollectSummary> => {
        setCollecting(true);
        try {
          const report = await apiJson<CollectSummary>('/inbound-collect', { method: 'POST' });
          await refresh();
          return report;
        } finally {
          setCollecting(false);
        }
      }
    : undefined;

  const pendingCount = emails.filter(m => m.status === 'a_traiter').length;

  return (
    <InboundDemoContext.Provider
      value={{
        emails,
        pendingCount,
        realData: !USE_API && DEMO_REAL_DATA,
        apiMode: USE_API,
        collecting,
        collectNow,
        updateExtracted,
        accept,
        reject,
      }}
    >
      {children}
    </InboundDemoContext.Provider>
  );
}
