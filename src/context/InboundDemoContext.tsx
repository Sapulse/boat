import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { InboundDemoContext, type CollectSummary } from './useInboundDemo';
import type { InboundEmail, InboundExtracted } from '../data/types';
import { MOCK_INBOUND_EMAILS } from '../data/mockInboundEmails';
import { USE_API } from '../lib/flags';
import { useApp } from './useApp';
import { buildLeadFromInbound, filterProcessedInbound, type ProcessedPage, type ProcessedStatusFilter } from '../lib/inbound';
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
  const { addLead, addAction, state } = useApp();
  const leads = state.leads;
  const [emails, setEmails] = useState<InboundEmail[]>(USE_API ? [] : DEMO_INITIAL);
  const [collecting, setCollecting] = useState(false);
  const [processedVersion, setProcessedVersion] = useState(0);
  const bump = () => setProcessedVersion(v => v + 1);

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
      bump();
      return out.lead.id;
    }
    // Démo : transitions à sens unique depuis 'a_traiter' (protège du double-clic).
    if (mail.status !== 'a_traiter') return mail.leadId ?? '';
    const leadId = addLead(buildLeadFromInbound(mail, commercialId, toISODate(new Date())));
    setEmails(prev => prev.map(m => (m.id === mail.id && m.status === 'a_traiter' ? { ...m, status: 'accepte', leadId, processedAt: new Date().toISOString() } : m)));
    bump();
    return leadId;
  };

  const reject = async (id: string): Promise<void> => {
    if (USE_API) {
      const out = await apiJson<{ inbound: InboundEmail }>(`/inbound/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reject' }),
      });
      setEmails(prev => prev.map(m => (m.id === id ? out.inbound : m)));
      bump();
      return;
    }
    setEmails(prev => prev.map(m => (m.id === id && m.status === 'a_traiter' ? { ...m, status: 'rejete', processedAt: new Date().toISOString() } : m)));
    bump();
  };

  /**
   * RATTACHE à un lead existant. Le serveur fait tout en une transaction ; en
   * démo on reproduit la même sémantique côté client — action d'historique de
   * type 'note' (jamais 'email' : ce type compte dans les objectifs du
   * commercial, cf. lib/goals.ts), datée du jour de RÉCEPTION. Le lead cible
   * n'est PAS modifié : ni sa température (le système ne la pose plus — retour
   * terrain 2026-09), ni `lastActionDate` (personne ne l'a encore rappelé).
   */
  const attach = async (mail: InboundEmail, leadId: string): Promise<void> => {
    if (USE_API) {
      const out = await apiJson<{ inbound: InboundEmail }>(`/inbound/${mail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'attach', leadId }),
      });
      setEmails(prev => prev.map(m => (m.id === mail.id ? out.inbound : m)));
      bump();
      return;
    }
    if (mail.status !== 'a_traiter') return;
    const target = leads.find(l => l.id === leadId);
    if (!target) return;
    const via = mail.sourceDetail ? `${mail.sourceLabel} — ${mail.sourceDetail}` : mail.sourceLabel;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(mail.receivedAt.slice(0, 10))
      ? mail.receivedAt.slice(0, 10)
      : toISODate(new Date());
    addAction({
      leadId,
      authorId: target.commercialId,
      type: 'note',
      date: day,
      result: `Demande entrante — ${via}`,
      notes: `Objet : ${mail.subject}\n\n${mail.excerpt}`,
    });
    setEmails(prev => prev.map(m => (m.id === mail.id && m.status === 'a_traiter' ? { ...m, status: 'rattache', leadId, processedAt: new Date().toISOString() } : m)));
    bump();
  };

  /** Remet en file un email REJETÉ. Les autres statuts ont créé des données : le
   *  serveur les refuse, et la démo applique la même règle. */
  const reopen = async (id: string): Promise<void> => {
    if (USE_API) {
      const out = await apiJson<{ inbound: InboundEmail }>(`/inbound/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reopen' }),
      });
      setEmails(prev => {
        // Un email rejeté ANCIEN (hors des 50 de la liste initiale) n'est pas
        // dans `emails` : on l'ajoute, sinon il ne réapparaîtrait pas dans la file.
        const known = prev.some(m => m.id === id);
        return known ? prev.map(m => (m.id === id ? out.inbound : m)) : [...prev, out.inbound];
      });
      bump();
      return;
    }
    setEmails(prev => prev.map(m => (
      m.id === id && m.status === 'rejete' ? { ...m, status: 'a_traiter', leadId: undefined, processedAt: undefined } : m
    )));
    bump();
  };

  /**
   * Page de « Traités ». API : filtrage et pagination serveur (tout
   * l'historique, pas seulement les 50 derniers). Démo : même calcul sur la
   * mémoire, trié par date de traitement décroissante.
   */
  const listProcessed = async (params: { status: ProcessedStatusFilter; q: string; offset: number; limit: number }): Promise<ProcessedPage> => {
    if (USE_API) {
      const qs = new URLSearchParams({ status: params.status, q: params.q, offset: String(params.offset), limit: String(params.limit) });
      return apiJson<ProcessedPage>(`/inbound/processed?${qs.toString()}`);
    }
    const sorted = [...emails].sort((a, b) => (b.processedAt ?? '').localeCompare(a.processedAt ?? ''));
    const { matches, counts } = filterProcessedInbound(sorted, params.status, params.q);
    const items = matches.slice(params.offset, params.offset + params.limit);
    const end = params.offset + items.length;
    return { items, total: matches.length, nextOffset: end < matches.length ? end : undefined, counts };
  };

  const collectNow = USE_API
    ? async (): Promise<CollectSummary> => {
        setCollecting(true);
        try {
          const report = await apiJson<CollectSummary>('/inbound-collect', { method: 'POST' });
          await refresh();
          bump();
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
        attach,
        reopen,
        listProcessed,
        processedVersion,
      }}
    >
      {children}
    </InboundDemoContext.Provider>
  );
}
