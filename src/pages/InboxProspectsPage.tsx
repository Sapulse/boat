import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, FlaskConical, Inbox, Mail, Minus, Plus, RefreshCw, X } from 'lucide-react';
import { useApp } from '../context/useApp';
import { useToast } from '../context/useToast';
import { useInboundDemo } from '../context/useInboundDemo';
import { findDuplicateLeads } from '../lib/duplicateLeads';
import {
  sortInboundByScore, scoreLevel, SCORE_LEVELS,
  inboundDisplayName, formatReceivedShort, formatReceivedAge, scoreReasonSign,
} from '../lib/inbound';
import { cn } from '../lib/utils';
import type { InboundEmail, Lead } from '../data/types';

// Écran « Leads entrants à valider » (spec §6). Une carte par email, triées par
// score décroissant (parasites < 40 repliés en bas — visibles, jamais cachés) ;
// champs éditables avant acceptation ; Accepter (choix du commercial ou « Non
// attribué ») crée RÉELLEMENT le lead ; Rejeter écarte. En mode API, le bouton
// « Importer les nouveaux emails » déclenche la collecte MANUELLE (aucun cron).
//
// Audit UX du 2026-07-30 — corrigé ici :
//  - la carte commence par QUI écrit et ce qu'il veut. Le nom vivait dans un
//    `<input>` au milieu de la carte : impossible de survoler la file ;
//  - `receivedAt` était affiché BRUT (« 2026-07-28T11:17:00Z » en mode réel) ->
//    date courte + fraîcheur, qui est ce qui décide de l'urgence ;
//  - le signal DOUBLON était sous les 6 champs, donc hors écran sur mobile,
//    alors que 9 des 20 emails du test à blanc visaient des prospects déjà
//    connus -> remonté juste sous l'identité ;
//  - les raisons du score étaient toutes du même gris (« Administratif » aussi
//    lisible que « Téléphone fourni ») -> séparées en + / − ;
//  - le bandeau violet « laboratoire » s'affichait aussi en production -> réduit
//    à une ligne repliable en mode réel, texte complet gardé en démo ;
//  - rejet GROUPÉ des parasites repliés : une session de 12 cartes coûtait 12
//    clics ;
//  - `findDuplicateLeads` tournait pour CHAQUE carte sur 323 leads à CHAQUE
//    frappe (~4 000 comparaisons par caractère) -> mémoïsé par carte sur
//    (leads, email, téléphone) : taper un prénom ne déclenche plus aucun calcul.

// Seuil d'affichage replié (aligné sur scoreLevel : < 40 = parasite probable).
const FOLD_THRESHOLD = 40;

export default function InboxProspectsPage() {
  const { state } = useApp();
  const { emails, pendingCount, realData, apiMode, collecting, collectNow, updateExtracted, accept, reject } = useInboundDemo();
  const toast = useToast();
  // Commercial choisi par carte ('' = Non attribué, défaut). Etat de PAGE (pas
  // du store) : un choix non validé n'a pas à survivre à la navigation.
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [bulkRejecting, setBulkRejecting] = useState(false);
  // Verrou anti double-clic par carte : une action ne part qu'une fois même si
  // deux clics précèdent le re-rendu (le store/serveur est de toute façon
  // idempotent — 409 si déjà traité). Retiré en cas d'échec pour permettre le retry.
  const processedRef = useRef(new Set<string>());

  const allPending = sortInboundByScore(emails.filter(m => m.status === 'a_traiter'));
  const pending = allPending.filter(m => m.score >= FOLD_THRESHOLD);
  const folded = allPending.filter(m => m.score < FOLD_THRESHOLD);
  const processed = emails.filter(m => m.status !== 'a_traiter');

  const handleAccept = async (mail: InboundEmail) => {
    if (processedRef.current.has(mail.id)) return;
    processedRef.current.add(mail.id);
    try {
      await accept(mail, assignees[mail.id] ?? '');
      toast.success(`Lead créé — ${inboundDisplayName(mail)}`);
    } catch (e) {
      processedRef.current.delete(mail.id);
      toast.error(`Échec de l'acceptation : ${(e as Error).message}`);
    }
  };

  const handleReject = async (mail: InboundEmail) => {
    if (processedRef.current.has(mail.id)) return;
    processedRef.current.add(mail.id);
    try {
      await reject(mail.id);
      toast.info('Email écarté');
    } catch (e) {
      processedRef.current.delete(mail.id);
      toast.error(`Échec du rejet : ${(e as Error).message}`);
    }
  };

  /**
   * Rejet GROUPÉ des parasites repliés. Séquentiel volontairement : la base est
   * un writer unique (SQLite), et on préfère un compte-rendu exact à de la
   * vitesse. Un échec n'interrompt pas les suivants et libère son verrou.
   *
   * La confirmation dit « définitif » parce que ça l'est aujourd'hui : le serveur
   * refuse toute action sur un email déjà traité. L'annulation reste à faire.
   */
  const handleRejectAllFolded = async () => {
    if (folded.length === 0 || bulkRejecting) return;
    const n = folded.length;
    if (!confirm(`Rejeter les ${n} email${n > 1 ? 's' : ''} classé${n > 1 ? 's' : ''} « parasite probable » ?\n\nCette action est définitive : un email rejeté ne peut pas être remis dans la file.`)) return;
    setBulkRejecting(true);
    let done = 0;
    const failures: string[] = [];
    for (const m of folded) {
      if (processedRef.current.has(m.id)) continue;
      processedRef.current.add(m.id);
      try { await reject(m.id); done++; } catch (e) {
        processedRef.current.delete(m.id);
        failures.push((e as Error).message);
      }
    }
    setBulkRejecting(false);
    if (failures.length === 0) toast.success(`${done} email${done > 1 ? 's' : ''} rejeté${done > 1 ? 's' : ''}`);
    else toast.error(`${done} rejeté(s), ${failures.length} échec(s) — ${failures[0]}`);
  };

  const handleCollect = async () => {
    if (!collectNow) return;
    try {
      const r = await collectNow();
      const parts = [`${r.inserted} nouveau${r.inserted > 1 ? 'x' : ''}`, `${r.alreadySeen} déjà vu${r.alreadySeen > 1 ? 's' : ''}`];
      if (r.autoRejected > 0) parts.push(`${r.autoRejected} administratif${r.autoRejected > 1 ? 's' : ''} auto-rejeté${r.autoRejected > 1 ? 's' : ''}`);
      toast.success(`Import : ${parts.join(', ')}`);
      if (r.truncated) toast.info('Fenêtre tronquée (plafond atteint) — relancez l\'import pour la suite.');
      for (const err of r.errors) toast.error(`Collecte : ${err}`);
    } catch (e) {
      toast.error(`Import impossible : ${(e as Error).message}`);
    }
  };

  const cardProps = (mail: InboundEmail) => ({
    mail,
    leads: state.leads,
    commercials: state.commercials.filter(c => c.active),
    assignee: assignees[mail.id] ?? '',
    onAssign: (commercialId: string) => setAssignees(prev => ({ ...prev, [mail.id]: commercialId })),
    onEdit: (patch: Partial<InboundEmail['extracted']>) => updateExtracted(mail.id, patch),
    onAccept: () => handleAccept(mail),
    onReject: () => handleReject(mail),
  });

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Boîte de réception prospects</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {pendingCount} à traiter · {processed.length} traité{processed.length > 1 ? 's' : ''}
          </span>
          {apiMode && collectNow && (
            <button type="button" className="btn-primary btn-sm" onClick={handleCollect} disabled={collecting}>
              <RefreshCw className={cn('w-4 h-4', collecting && 'animate-spin')} />
              {collecting ? 'Import en cours…' : 'Importer les nouveaux emails'}
            </button>
          )}
        </div>
      </div>

      {/* Mode RÉEL : une ligne, repliable. Le pavé d'explications était utile
          pendant la mise au point ; en production il repousse le travail vers le
          bas à chaque visite. Icône neutre : la fiole signalait « expérimental »
          sur un écran de production. */}
      {apiMode ? (
        <details className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600">
          <summary className="cursor-pointer flex items-center gap-2 font-medium text-gray-700">
            <Inbox className="w-4 h-4 shrink-0" />
            Boîte réelle · import manuel · rien n'entre dans les leads sans votre clic
          </summary>
          <p className="mt-2">
            « Importer les nouveaux emails » relève l'Inbox (lecture seule, rien n'est modifié dans
            Outlook) : fenêtre des 7 derniers jours au premier import, puis reprise là où on s'était
            arrêté. Les emails administratifs sont auto-rejetés, avec trace.
          </p>
        </details>
      ) : (
        <div className="rounded-lg border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-violet-900 flex gap-3">
          <FlaskConical className="w-5 h-5 shrink-0 mt-0.5" />
          {realData ? (
            <div>
              <p className="font-semibold">Démonstration sur les VRAIS emails de l'échantillon — analysés en local, aucune boîte mail n'est connectée.</p>
              <p className="mt-0.5">
                Données personnelles réelles (fichier local, jamais publié) : ne pas diffuser cet écran hors
                démo interne. Les cartes se réinitialisent au rechargement de la page ; les leads{' '}
                <strong>acceptés</strong> sont en revanche réellement créés dans le CRM.
              </p>
            </div>
          ) : (
            <div>
              <p className="font-semibold">Données de démonstration — aucun email réel n'est lu.</p>
              <p className="mt-0.5">
                Emails fictifs inspirés de la spec d'import. Les cartes se réinitialisent au rechargement de la
                page ; les leads <strong>acceptés</strong> sont en revanche réellement créés dans le CRM.
                Astuce démo : acceptez la carte boats.com (Marc Le Goff), puis observez le signal doublon sur sa
                relance via le site.
              </p>
            </div>
          )}
        </div>
      )}

      {allPending.length === 0 ? (
        <div className="card p-10 text-center text-gray-500">
          <Inbox className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-700">Aucun email en attente</p>
          <p className="text-sm mt-1">
            {apiMode ? 'Cliquez « Importer les nouveaux emails » pour relever la boîte.' : 'Rechargez la page pour rejouer la démonstration.'}
          </p>
        </div>
      ) : (
        pending.map(mail => <InboundCard key={mail.id} {...cardProps(mail)} />)
      )}

      {/* Parasites probables (< 40) : REPLIÉS mais jamais cachés — décision
          validée : tout reste visible tant que le tri n'a pas fait ses preuves.
          Rejet groupé : le geste le plus fréquent de la session de tri. */}
      {folded.length > 0 && (
        <div className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <details className="flex-1 min-w-[200px]">
              <summary className="cursor-pointer text-sm font-semibold text-gray-700">
                Probables parasites — {folded.length} replié{folded.length > 1 ? 's' : ''} (score &lt; {FOLD_THRESHOLD})
              </summary>
              <div className="mt-4 space-y-4">
                {folded.map(mail => <InboundCard key={mail.id} {...cardProps(mail)} />)}
              </div>
            </details>
            <button
              type="button"
              onClick={handleRejectAllFolded}
              disabled={bulkRejecting}
              className="btn-secondary btn-sm shrink-0 self-start disabled:opacity-50"
            >
              <X className="w-4 h-4" />
              {bulkRejecting ? 'Rejet en cours…' : `Rejeter les ${folded.length}`}
            </button>
          </div>
        </div>
      )}

      {processed.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Traités</h2>
          <ul className="divide-y divide-gray-100">
            {processed.map(mail => (
              <li key={mail.id} className="py-2 flex items-center gap-3 text-sm">
                <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="flex-1 truncate text-gray-700">
                  {inboundDisplayName(mail)}
                  <span className="text-gray-400"> — {mail.subject}</span>
                </span>
                {mail.status === 'accepte' ? (
                  <>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Accepté</span>
                    {mail.leadId && (
                      <Link to={`/leads/${mail.leadId}`} className="text-primary-600 hover:underline whitespace-nowrap">
                        Voir le lead
                      </Link>
                    )}
                  </>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Rejeté</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface InboundCardProps {
  mail: InboundEmail;
  /** Base de comparaison anti-doublon. On passe les leads (et non le résultat)
   *  pour que le calcul soit mémoïsé ICI, sur l'email/tél de CETTE carte. */
  leads: Lead[];
  commercials: { id: string; name: string }[];
  assignee: string;
  onAssign: (commercialId: string) => void;
  onEdit: (patch: Partial<InboundEmail['extracted']>) => void;
  onAccept: () => void;
  onReject: () => void;
}

function InboundCard({ mail, leads, commercials, assignee, onAssign, onEdit, onAccept, onReject }: InboundCardProps) {
  const level = SCORE_LEVELS[scoreLevel(mail.score)];
  const x = mail.extracted;

  // Mémoïsé sur (leads, email, téléphone) UNIQUEMENT : taper un prénom ou une
  // marque ne relance plus le balayage des 323 leads, ni ici ni sur les autres
  // cartes (leurs dépendances n'ont pas bougé).
  const duplicates = useMemo(
    () => findDuplicateLeads(leads, { email: x.email, phone: x.phone }),
    [leads, x.email, x.phone],
  );

  // Raisons du score groupées par signe : ce qui PÉNALISE d'abord, c'est ce qui
  // demande une décision. `inconnu` reste neutre (jamais peint à l'envers).
  const negatives = mail.scoreReasons.filter(r => scoreReasonSign(r) === 'negatif');
  const positives = mail.scoreReasons.filter(r => scoreReasonSign(r) === 'positif');
  const neutrals = mail.scoreReasons.filter(r => scoreReasonSign(r) === 'inconnu');

  const wants = [x.boatInterest, x.brand].filter(Boolean).join(' · ');
  const age = formatReceivedAge(mail.receivedAt, new Date());

  return (
    <div className="card p-5 space-y-3">
      {/* 1. QUI écrit, ce qu'il veut, quand — l'identité d'abord. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-gray-900 break-words">{inboundDisplayName(mail)}</h3>
          <p className="text-xs text-gray-500 break-words">{wants || 'Bateau non précisé'}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-600">{formatReceivedShort(mail.receivedAt)}</p>
          {age && <p className="text-xs text-gray-400">{age}</p>}
        </div>
      </div>

      {/* 2. DOUBLON juste sous l'identité : au test à blanc, 9 emails sur 20
             visaient un prospect déjà en base. Signal NON bloquant, cohérent
             avec la création manuelle (LeadForm). */}
      {duplicates.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          <p className="font-medium text-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Doublon possible : {duplicates.length > 1 ? 'des leads existent déjà' : 'un lead existe déjà'} avec cet email ou ce téléphone
          </p>
          <p className="text-amber-700 mt-0.5">
            {duplicates.slice(0, 3).map((l, i) => (
              <span key={l.id}>
                {i > 0 && ', '}
                <Link to={`/leads/${l.id}`} className="underline hover:text-amber-900">
                  {`${l.firstName} ${l.lastName}`.trim() || l.email || l.phone}
                </Link>
              </span>
            ))}
            {duplicates.length > 3 ? ` +${duplicates.length - 3}` : ''}
          </p>
        </div>
      )}

      {/* 3. Provenance et score (la jauge redondante a été retirée : le libellé
             et la couleur du badge portent déjà le niveau). */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          {mail.sourceLabel}
        </span>
        {mail.sourceDetail && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            {mail.sourceDetail}
          </span>
        )}
        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', level.badge)}>
          {level.label} · {mail.score}/100
        </span>
      </div>

      {/* 4. Pourquoi ce score : ce qui pénalise, puis ce qui rassure. */}
      {(negatives.length > 0 || positives.length > 0 || neutrals.length > 0) && (
        <ul className="space-y-0.5 text-xs">
          {negatives.map(r => (
            <li key={r} className="flex items-start gap-1.5 text-red-700">
              <Minus className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span className="break-words">{r}</span>
            </li>
          ))}
          {positives.map(r => (
            <li key={r} className="flex items-start gap-1.5 text-green-700">
              <Plus className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span className="break-words">{r}</span>
            </li>
          ))}
          {neutrals.map(r => (
            <li key={r} className="flex items-start gap-1.5 text-gray-500">
              <span className="shrink-0">•</span><span className="break-words">{r}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 5. Email d'origine */}
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm">
        {/* break-words : les URLs longues des extraits débordaient de 8px sur
            mobile (audit) — césure forcée, jamais de scroll latéral. */}
        <p className="text-xs text-gray-500 break-words">
          De : <span className="font-medium text-gray-700">{mail.fromAddress}</span>
          <span className="mx-1.5">·</span>
          Objet : <span className="font-medium text-gray-700">{mail.subject}</span>
        </p>
        <p className="mt-1.5 text-gray-700 whitespace-pre-line break-words">{mail.excerpt}</p>
      </div>

      {/* 6. Champs extraits, ÉDITABLES avant acceptation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="label">Prénom</label>
          <input className="input" value={x.firstName} onChange={e => onEdit({ firstName: e.target.value })} />
        </div>
        <div>
          <label className="label">Nom</label>
          <input className="input" value={x.lastName} onChange={e => onEdit({ lastName: e.target.value })} />
        </div>
        <div>
          <label className="label">Téléphone</label>
          <input className="input" value={x.phone} onChange={e => onEdit({ phone: e.target.value })} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={x.email} onChange={e => onEdit({ email: e.target.value })} />
        </div>
        <div>
          <label className="label">Bateau / intérêt</label>
          <input className="input" value={x.boatInterest} onChange={e => onEdit({ boatInterest: e.target.value })} />
        </div>
        <div>
          <label className="label">Marque</label>
          <input className="input" value={x.brand} onChange={e => onEdit({ brand: e.target.value })} />
        </div>
      </div>

      {/* 7. Actions : attribution + Accepter / Rejeter */}
      <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-gray-200">
        <div className="flex-1 min-w-[180px] max-w-xs">
          <label className="label">Attribuer à</label>
          <select className="select" value={assignee} onChange={e => onAssign(e.target.value)}>
            <option value="">Non attribué</option>
            {commercials.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onReject} className="btn-secondary">
            <X className="w-4 h-4" /> Rejeter
          </button>
          <button type="button" onClick={onAccept} className="btn-primary">
            <Check className="w-4 h-4" /> Accepter — créer le lead
          </button>
        </div>
      </div>
    </div>
  );
}
