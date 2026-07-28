import { getGraphToken, SOURCE_FILTERS, type GraphEnv } from './graph.js';

// Collecte des emails prospects (Étape B, pipeline) — LECTURE SEULE.
// Va chercher dans la Boîte de réception (dossier canonique `inbox`, insensible
// à la langue et aux renommages) les emails RÉCENTS des 4 familles de sources,
// et les rend prêts pour parseEmail. AUCUNE écriture Graph : pas de marquage
// lu, pas de déplacement — la permission app-only Mail.Read ne le permet
// d'ailleurs pas. `fetchFn` injectable (harnais sans réseau).
//
// Garde-fous anti-déluge (stratégie validée) :
//  - filtre de DATE côté requête (receivedDateTime ge sinceIso) : l'historique
//    n'est jamais téléchargé ;
//  - filtre de SOURCE côté requête : 4 expéditeurs connus, un appel par
//    famille (chaque filtre prouvé sur le tenant réel) — le reste de la boîte
//    n'est jamais lu ;
//  - CAP global par exécution (défaut 50) : au-delà, troncature signalée,
//    jamais un traitement de masse silencieux.

export interface CollectedMessage {
  graphId: string;
  internetMessageId: string;
  receivedAt: string; // ISO UTC
  fromName: string;
  fromAddress: string;
  subject: string;
  text?: string;
  html?: string;
  /** Famille dont le filtre a remonté ce message (libellé graph.ts). */
  familyLabel: string;
}

export interface CollectResult {
  messages: CollectedMessage[]; // dédupliqués (internetMessageId), tri chronologique
  /** true si le cap a tronqué la fenêtre — il reste des emails non listés. */
  truncated: boolean;
  /** Erreurs PAR FAMILLE (non bloquantes : les autres familles continuent). */
  errors: string[];
}

export const DEFAULT_COLLECT_CAP = 50;

interface GraphMessage {
  id: string;
  internetMessageId?: string;
  receivedDateTime?: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  body?: { contentType?: string; content?: string };
}

/** Entrée parseEmail d'un message collecté ("Nom <adresse>" pour l'enveloppe). */
export function toParseInput(msg: CollectedMessage): { from: string; subject: string; text?: string; html?: string } {
  return {
    from: msg.fromName ? `${msg.fromName} <${msg.fromAddress}>` : msg.fromAddress,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  };
}

export async function fetchRecentSourceEmails(
  env: GraphEnv,
  opts: { sinceIso: string; cap?: number; fetchFn?: typeof fetch },
): Promise<CollectResult> {
  const cap = opts.cap ?? DEFAULT_COLLECT_CAP;
  const fetchFn = opts.fetchFn ?? fetch;
  const errors: string[] = [];

  const tok = await getGraphToken(env, fetchFn);
  if ('error' in tok) return { messages: [], truncated: false, errors: [tok.error] };

  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.mailbox)}`;
  const headers = {
    Authorization: `Bearer ${tok.token}`,
    ConsistencyLevel: 'eventual',
    // Corps demandé en TEXTE (Outlook convertit) : parseEmail préfère le texte,
    // le HTML reste un repli si le tenant ignore la préférence.
    Prefer: 'outlook.body-content-type="text"',
  };

  const byId = new Map<string, CollectedMessage>();
  for (const { label, filter } of SOURCE_FILTERS) {
    const query = `(${filter}) and receivedDateTime ge ${opts.sinceIso}`;
    // Pas de $orderby : combiné aux filtres « advanced query », Graph le refuse
    // souvent (InefficientFilter). Le tri est fait côté code.
    const url = `${base}/mailFolders/inbox/messages?$filter=${encodeURIComponent(query)}`
      + `&$count=true&$top=${cap}&$select=id,internetMessageId,receivedDateTime,subject,from,body`;
    const res = await fetchFn(url, { headers });
    if (!res.ok) {
      errors.push(`${label} : HTTP ${res.status}`);
      continue;
    }
    const page = await res.json() as { value?: GraphMessage[] };
    for (const g of page.value ?? []) {
      // Sans internetMessageId (rarissime), repli sur l'id Graph : on ne perd
      // jamais un email, on perd juste la stabilité inter-dossiers du verrou.
      const key = g.internetMessageId ?? g.id;
      if (byId.has(key)) continue;
      const isHtml = /html/i.test(g.body?.contentType ?? '');
      byId.set(key, {
        graphId: g.id,
        internetMessageId: key,
        receivedAt: g.receivedDateTime ?? '',
        fromName: g.from?.emailAddress?.name ?? '',
        fromAddress: (g.from?.emailAddress?.address ?? '').toLowerCase(),
        subject: g.subject ?? '',
        text: isHtml ? undefined : g.body?.content ?? '',
        html: isHtml ? g.body?.content : undefined,
        familyLabel: label,
      });
    }
  }

  const all = [...byId.values()].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const truncated = all.length > cap;
  return { messages: truncated ? all.slice(0, cap) : all, truncated, errors };
}
