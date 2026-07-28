import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, FlaskConical, Inbox, Mail, X } from 'lucide-react';
import { useApp } from '../context/useApp';
import { useToast } from '../context/useToast';
import { useInboundDemo } from '../context/useInboundDemo';
import { findDuplicateLeads } from '../lib/duplicateLeads';
import { sortInboundByScore, scoreLevel, SCORE_LEVELS, buildLeadFromInbound } from '../lib/inbound';
import { toISODate, cn } from '../lib/utils';
import type { InboundEmail } from '../data/types';

// Écran « Leads entrants à valider » (spec §6, Étape A — maquette sur données
// fictives). Une carte par email, triées par score décroissant ; champs
// éditables avant acceptation ; Accepter (choix du commercial ou « Non
// attribué ») crée RÉELLEMENT le lead via addLead ; Rejeter écarte la carte.

export default function InboxProspectsPage() {
  const { state, addLead } = useApp();
  const { emails, pendingCount, realData, updateExtracted, accept, reject } = useInboundDemo();
  const toast = useToast();
  // Commercial choisi par carte ('' = Non attribué, défaut). Etat de PAGE (pas
  // du store) : un choix non validé n'a pas à survivre à la navigation.
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  // Verrou anti double-clic par carte : addLead ne doit tourner qu'une fois
  // même si deux clics partent avant le re-rendu (le store, lui, est idempotent).
  const processedRef = useRef(new Set<string>());

  const pending = sortInboundByScore(emails.filter(m => m.status === 'a_traiter'));
  const processed = emails.filter(m => m.status !== 'a_traiter');

  const handleAccept = (mail: InboundEmail) => {
    if (processedRef.current.has(mail.id)) return;
    processedRef.current.add(mail.id);
    const leadId = addLead(buildLeadFromInbound(mail, assignees[mail.id] ?? '', toISODate(new Date())));
    accept(mail.id, leadId);
    const name = `${mail.extracted.firstName} ${mail.extracted.lastName}`.trim() || mail.subject;
    toast.success(`Lead créé — ${name}`);
  };

  const handleReject = (mail: InboundEmail) => {
    if (processedRef.current.has(mail.id)) return;
    processedRef.current.add(mail.id);
    reject(mail.id);
    toast.info('Email écarté');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Boîte de réception prospects</h1>
        <span className="text-sm text-gray-500">
          {pendingCount} à traiter · {processed.length} traité{processed.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Bandeau maquette : démo rejouable (cartes réinitialisées au rechargement),
          seuls les leads acceptés entrent réellement dans le CRM. Deux modes :
          fixtures fictives, ou VRAIS emails de l'échantillon analysés localement. */}
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

      {pending.length === 0 ? (
        <div className="card p-10 text-center text-gray-500">
          <Inbox className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-700">Aucun email en attente</p>
          <p className="text-sm mt-1">Rechargez la page pour rejouer la démonstration.</p>
        </div>
      ) : (
        pending.map(mail => (
          <InboundCard
            key={mail.id}
            mail={mail}
            duplicates={findDuplicateLeads(state.leads, { email: mail.extracted.email, phone: mail.extracted.phone })}
            commercials={state.commercials.filter(c => c.active)}
            assignee={assignees[mail.id] ?? ''}
            onAssign={(commercialId) => setAssignees(prev => ({ ...prev, [mail.id]: commercialId }))}
            onEdit={(patch) => updateExtracted(mail.id, patch)}
            onAccept={() => handleAccept(mail)}
            onReject={() => handleReject(mail)}
          />
        ))
      )}

      {processed.length > 0 && (
        <div className="card p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Traités</h2>
          <ul className="divide-y divide-gray-100">
            {processed.map(mail => (
              <li key={mail.id} className="py-2 flex items-center gap-3 text-sm">
                <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                <span className="flex-1 truncate text-gray-700">
                  {`${mail.extracted.firstName} ${mail.extracted.lastName}`.trim() || mail.fromAddress}
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
  duplicates: ReturnType<typeof findDuplicateLeads>;
  commercials: { id: string; name: string }[];
  assignee: string;
  onAssign: (commercialId: string) => void;
  onEdit: (patch: Partial<InboundEmail['extracted']>) => void;
  onAccept: () => void;
  onReject: () => void;
}

function InboundCard({ mail, duplicates, commercials, assignee, onAssign, onEdit, onAccept, onReject }: InboundCardProps) {
  const level = SCORE_LEVELS[scoreLevel(mail.score)];
  const x = mail.extracted;

  return (
    <div className="card p-5 space-y-4">
      {/* En-tête : source + score */}
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
        <span className="ml-auto text-xs text-gray-400">{mail.receivedAt}</span>
      </div>

      {/* Jauge de score + signaux */}
      <div>
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div className={cn('h-full rounded-full', level.bar)} style={{ width: `${mail.score}%` }} />
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          {mail.scoreReasons.map(r => <li key={r}>• {r}</li>)}
        </ul>
      </div>

      {/* Email d'origine */}
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm">
        <p className="text-xs text-gray-500">
          De : <span className="font-medium text-gray-700">{mail.fromAddress}</span>
          <span className="mx-1.5">·</span>
          Objet : <span className="font-medium text-gray-700">{mail.subject}</span>
        </p>
        <p className="mt-1.5 text-gray-700 whitespace-pre-line">{mail.excerpt}</p>
      </div>

      {/* Champs extraits, ÉDITABLES avant acceptation */}
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

      {/* Anti-doublon (findDuplicateLeads, live sur email/tél édités) — signal
          NON bloquant, cohérent avec la création manuelle (LeadForm). */}
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

      {/* Actions : attribution + Accepter / Rejeter */}
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
