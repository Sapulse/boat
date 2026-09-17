import { useEffect, useMemo, useState, lazy, Suspense, Fragment } from 'react';
import { Save, ChevronLeft, ChevronRight, Pencil, Archive, ArchiveRestore, Plus, CalendarRange, Settings2 } from 'lucide-react';
import { useApp } from '../../context/useApp';
import { useToast } from '../../context/useToast';
import Repliable from '../ui/Repliable';
import { MONTHS } from '../../data/constants';
import { buildYearRange, cn, generateId } from '../../lib/utils';
import {
  activeNetworks, orderedNetworks, historyNetworks, historyMonths, followersSeries, followersVariation, formatDelta,
  findStat, draftFromStat, buildSave, parseCount, validateNetworkName, statKey, monthLabel,
  NETWORK_ERROR_LABEL, DRAFT_ERROR_LABEL, NETWORK_NAME_MAX, SOCIAL_COMMENT_MAX,
  type StatDraft, type DraftError,
} from '../../lib/social';
import type { SocialNetwork, SocialStat } from '../../data/types';

// ===========================================================================
// Onglet « Réseaux sociaux » d'Acquisition (lot 5). MÊME MÉCANISME que l'onglet
// Saisie : navigation mois par mois, brouillon local conservé d'un mois à
// l'autre, garde « modifications non enregistrées » (onglet + fermeture),
// enregistrement groupé. Données À PART (social_networks / social_stats) :
// MonthlyStat n'est pas touché. Règles : lib/social (prouvées au harnais).
// ===========================================================================

const FollowersChart = lazy(() => import('./AcquisitionCharts').then(m => ({ default: m.FollowersChart })));

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = buildYearRange();
// Couleur stable d'un réseau (rang dans la liste complète) — ici et non dans le chunk recharts.
const COLORS = ['#2563eb', '#db2777', '#0e7490', '#d97706', '#7c3aed', '#16a34a', '#dc2626', '#475569'];

const INPUT_CLS = 'input text-sm w-full text-right tabular-nums';
const fmt = (n: number) => n.toLocaleString('fr-FR');

function DeltaBadge({ stats, networkId, year, month, compact = false }: { stats: SocialStat[]; networkId: string; year: number; month: number; compact?: boolean }) {
  const v = followersVariation(stats, networkId, year, month);
  if (v.delta === null || !v.since) return <span className="text-xs text-gray-300">—</span>;
  const tone = v.delta > 0 ? 'text-success-700' : v.delta < 0 ? 'text-danger-600' : 'text-gray-500';
  const since = v.previousMonth ? '' : `depuis ${MONTHS[v.since.month - 1].toLowerCase()}${v.since.year !== year ? ` ${v.since.year}` : ''}`;
  return (
    <span className={cn('text-xs font-semibold tabular-nums', tone)} title={`Variation depuis ${monthLabel(v.since.year, v.since.month)}`} data-testid="variation">
      {formatDelta(v.delta)}
      {since && <span className={cn('font-normal text-gray-400', compact ? 'ml-1' : 'block')}>{since}</span>}
    </span>
  );
}

function StatDetails({ s }: { s: SocialStat }) {
  const parts = [s.posts !== null ? `${fmt(s.posts)} publication${s.posts > 1 ? 's' : ''}` : '', s.reach !== null ? `${fmt(s.reach)} de portée` : ''].filter(Boolean);
  return parts.length ? <span className="block text-[11px] text-gray-400">{parts.join(' · ')}</span> : null;
}

// ---------------------------------------------------------------------------
// Saisie d'un mois : une carte par réseau actif
// ---------------------------------------------------------------------------

function NetworkCard({ network, color, draft, saved, errors, stats, year, month, onChange }: {
  network: SocialNetwork; color: string; draft: StatDraft; saved: SocialStat | undefined; errors: DraftError[] | undefined;
  stats: SocialStat[]; year: number; month: number; onChange: (d: StatDraft) => void;
}) {
  const id = `${network.id}-${year}-${month}`;
  const set = (field: keyof StatDraft) => (e: { target: { value: string } }) => onChange({ ...draft, [field]: e.target.value });
  // Aperçu de la variation : abonnés en cours de saisie contre le dernier mois saisi avant.
  const typed = parseCount(draft.followers);
  const preview = typeof typed === 'number' && !Number.isNaN(typed)
    ? followersVariation([...stats.filter(s => statKey(s) !== statKey({ networkId: network.id, year, month })), { id: 'apercu', networkId: network.id, year, month, followers: typed, posts: null, reach: null, comment: '' }], network.id, year, month)
    : null;
  return (
    <div className={cn('card p-4 space-y-3', errors?.length && 'ring-2 ring-danger-200')} data-testid={`carte-${network.id}`}>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} aria-hidden />
        <h4 className="text-sm font-semibold text-gray-900 flex-1 truncate">{network.name}</h4>
        {saved ? <span className="text-[11px] text-gray-400">enregistré</span> : <span className="text-[11px] text-gray-300">non saisi</span>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-3 sm:col-span-1">
          <label htmlFor={`${id}-abonnes`} className="block text-xs font-medium text-gray-600 mb-1">Abonnés <span className="text-danger-600">*</span></label>
          <input id={`${id}-abonnes`} className={INPUT_CLS} inputMode="numeric" autoComplete="off" value={draft.followers} onChange={set('followers')} placeholder="—" />
        </div>
        <div className="col-span-3 sm:col-span-1 grid grid-cols-2 sm:grid-cols-1 gap-2 sm:contents">
          <div>
            <label htmlFor={`${id}-posts`} className="block text-xs font-medium text-gray-600 mb-1">Publications</label>
            <input id={`${id}-posts`} className={INPUT_CLS} inputMode="numeric" autoComplete="off" value={draft.posts} onChange={set('posts')} placeholder="—" />
          </div>
          <div>
            <label htmlFor={`${id}-portee`} className="block text-xs font-medium text-gray-600 mb-1">Portée</label>
            <input id={`${id}-portee`} className={INPUT_CLS} inputMode="numeric" autoComplete="off" value={draft.reach} onChange={set('reach')} placeholder="—" />
          </div>
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-commentaire`} className="block text-xs font-medium text-gray-600 mb-1">Commentaire</label>
        <textarea id={`${id}-commentaire`} className="input text-sm w-full" rows={2} maxLength={SOCIAL_COMMENT_MAX} value={draft.comment} onChange={set('comment')} placeholder="Campagne, événement, changement notable…" />
      </div>
      <div className="flex items-center justify-between text-xs min-h-[18px]">
        <span className="text-gray-500">Variation</span>
        {preview && preview.delta !== null && preview.since ? (
          <span className={cn('font-semibold tabular-nums', preview.delta > 0 ? 'text-success-700' : preview.delta < 0 ? 'text-danger-600' : 'text-gray-500')}>
            {formatDelta(preview.delta)} <span className="font-normal text-gray-400">depuis {monthLabel(preview.since.year, preview.since.month)}</span>
          </span>
        ) : <span className="text-gray-300">—</span>}
      </div>
      {errors?.length ? (
        <ul className="text-xs text-danger-700 space-y-0.5" role="alert">
          {[...new Set(errors)].map(e => <li key={e}>{DRAFT_ERROR_LABEL[e]}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gestion des réseaux : ajouter, renommer, archiver (jamais supprimer)
// ---------------------------------------------------------------------------

function NetworksManager({ networks, colorOf }: { networks: SocialNetwork[]; colorOf: (id: string) => string }) {
  const { addSocialNetwork, renameSocialNetwork, setSocialNetworkArchived, state } = useApp();
  const toast = useToast();
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const stats = state.socialStats ?? [];

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateNetworkName(newName, networks);
    if (errors.length) { toast.error(NETWORK_ERROR_LABEL[errors[0]]); return; }
    addSocialNetwork(newName);
    toast.success(`Réseau « ${newName.trim()} » ajouté`);
    setNewName('');
  };
  const rename = (n: SocialNetwork) => {
    if (draft.trim() === n.name) { setEditing(null); return; }
    const errors = validateNetworkName(draft, networks, n.id);
    if (errors.length) { toast.error(NETWORK_ERROR_LABEL[errors[0]]); return; }
    renameSocialNetwork(n.id, draft);
    toast.success('Réseau renommé');
    setEditing(null);
  };
  const toggle = (n: SocialNetwork) => {
    setSocialNetworkArchived(n.id, !n.archived);
    toast.info(n.archived ? `« ${n.name} » réactivé : il revient dans la saisie` : `« ${n.name} » archivé : retiré de la saisie, conservé dans l'historique`);
  };

  return (
    <div className="space-y-3 mt-3">
      <ul className="divide-y divide-gray-100" data-testid="liste-reseaux">
        {networks.map(n => (
          <li key={n.id} className="py-2 flex flex-wrap items-center gap-2" data-testid={`reseau-${n.id}`}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorOf(n.id) }} aria-hidden />
            {editing === n.id ? (
              <form className="flex flex-1 min-w-[200px] gap-2" onSubmit={e => { e.preventDefault(); rename(n); }}>
                <label htmlFor={`renommer-${n.id}`} className="sr-only">Nouveau nom de {n.name}</label>
                <input id={`renommer-${n.id}`} className="input text-sm flex-1" maxLength={NETWORK_NAME_MAX} value={draft} onChange={e => setDraft(e.target.value)} autoFocus />
                <button type="button" onClick={() => setEditing(null)} className="btn-ghost btn-sm">Annuler</button>
                <button type="submit" className="btn-primary btn-sm">Enregistrer</button>
              </form>
            ) : (
              <>
                <span className={cn('text-sm flex-1 min-w-0 truncate', n.archived ? 'text-gray-400' : 'text-gray-900 font-medium')}>{n.name}</span>
                {n.archived && <span className="text-[11px] rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">Archivé</span>}
                <span className="text-[11px] text-gray-400">{stats.filter(s => s.networkId === n.id).length} mois</span>
                <button type="button" onClick={() => { setDraft(n.name); setEditing(n.id); }} className="btn-ghost btn-sm text-xs min-h-[36px]">
                  <Pencil className="w-3.5 h-3.5" /> Renommer
                </button>
                <button type="button" onClick={() => toggle(n)} className="btn-ghost btn-sm text-xs min-h-[36px] text-gray-500">
                  {n.archived ? <><ArchiveRestore className="w-3.5 h-3.5" /> Réactiver</> : <><Archive className="w-3.5 h-3.5" /> Archiver</>}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-col sm:flex-row gap-2" data-testid="ajout-reseau">
        <label htmlFor="nouveau-reseau" className="sr-only">Nouveau réseau</label>
        <input id="nouveau-reseau" className="input text-sm flex-1" placeholder="Nouveau réseau (ex. YouTube)" maxLength={NETWORK_NAME_MAX} value={newName} onChange={e => setNewName(e.target.value)} />
        <button type="submit" className="btn-secondary btn-sm justify-center min-h-[40px]"><Plus className="w-4 h-4" /> Ajouter</button>
      </form>
      <p className="text-xs text-gray-400">Un réseau n&apos;est jamais supprimé : archivé, il sort de la saisie mais reste dans l&apos;historique et la courbe.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historique mois par mois (tableau sur ordinateur, cartes sur mobile)
// ---------------------------------------------------------------------------

function History({ stats, networks, colorOf, onEdit }: { stats: SocialStat[]; networks: SocialNetwork[]; colorOf: (id: string) => string; onEdit: (year: number, month: number) => void }) {
  const months = historyMonths(stats);
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpenComments(s => ({ ...s, [key]: !s[key] }));
  const commentsOf = (year: number, month: number) => networks
    .map(n => ({ n, s: findStat(stats, n.id, year, month) }))
    .filter((x): x is { n: SocialNetwork; s: SocialStat } => !!x.s?.comment);

  if (months.length === 0) return <p className="text-sm text-gray-400 py-4">Aucun mois saisi pour l&apos;instant.</p>;

  return (
    <>
      {/* Ordinateur */}
      <div className="hidden sm:block overflow-x-auto" data-testid="historique-tableau">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-2.5 text-left font-medium text-gray-600">Mois</th>
              {networks.map(n => (
                <th key={n.id} className="px-4 py-2.5 text-right font-medium text-gray-600 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorOf(n.id) }} aria-hidden />
                    {n.name}{n.archived && <span className="text-[10px] font-normal text-gray-400">(archivé)</span>}
                  </span>
                </th>
              ))}
              <th className="px-2 py-2.5 w-24" />
            </tr>
          </thead>
          <tbody>
            {months.map(({ year, month }) => {
              const key = `${year}-${month}`;
              const comments = commentsOf(year, month);
              return (
                <Fragment key={key}>
                  <tr className="border-b border-gray-100 align-top" data-testid={`mois-${key}`}>
                    <td className="px-4 py-2.5 font-medium text-gray-900 whitespace-nowrap">{MONTHS[month - 1]} {year}</td>
                    {networks.map(n => {
                      const s = findStat(stats, n.id, year, month);
                      return (
                        <td key={n.id} className="px-4 py-2.5 text-right">
                          {s ? (
                            <>
                              <span className="flex items-baseline justify-end gap-2">
                                <span className="font-semibold text-gray-900 tabular-nums">{fmt(s.followers)}</span>
                                <DeltaBadge stats={stats} networkId={n.id} year={year} month={month} compact />
                              </span>
                              <StatDetails s={s} />
                            </>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {comments.length > 0 && (
                        <button type="button" onClick={() => toggle(key)} aria-expanded={!!openComments[key]} aria-label={`${openComments[key] ? 'Masquer' : 'Afficher'} les commentaires de ${monthLabel(year, month)}`} className="btn-ghost btn-sm px-2" title="Commentaires">
                          💬<span className="text-xs text-gray-500">{comments.length}</span>
                        </button>
                      )}
                      <button type="button" onClick={() => onEdit(year, month)} aria-label={`Corriger ${monthLabel(year, month)}`} className="btn-ghost btn-sm px-2" title="Corriger ce mois">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                  {openComments[key] && (
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <td colSpan={networks.length + 2} className="px-4 py-2">
                        <ul className="space-y-1 text-sm" data-testid={`commentaires-${key}`}>
                          {comments.map(({ n, s }) => (
                            <li key={n.id}><span className="font-medium text-gray-700">{n.name} :</span> <span className="text-gray-600 whitespace-pre-line">{s.comment}</span></li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile : une carte par mois */}
      <div className="sm:hidden space-y-3" data-testid="historique-cartes">
        {months.map(({ year, month }) => {
          const key = `${year}-${month}`;
          const comments = commentsOf(year, month);
          return (
            <div key={key} className="rounded-lg border border-gray-200 p-3" data-testid={`carte-mois-${key}`}>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-900">{MONTHS[month - 1]} {year}</h4>
                <div className="flex items-center gap-1">
                  {comments.length > 0 && (
                    <button type="button" onClick={() => toggle(key)} aria-expanded={!!openComments[key]} aria-label={`${openComments[key] ? 'Masquer' : 'Afficher'} les commentaires de ${monthLabel(year, month)}`} className="btn-ghost btn-sm min-h-[40px] min-w-[40px] justify-center">
                      💬<span className="text-xs text-gray-500">{comments.length}</span>
                    </button>
                  )}
                  <button type="button" onClick={() => onEdit(year, month)} aria-label={`Corriger ${monthLabel(year, month)}`} className="btn-ghost btn-sm min-h-[40px] min-w-[40px] justify-center">
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-gray-100">
                {networks.map(n => {
                  const s = findStat(stats, n.id, year, month);
                  return (
                    <li key={n.id} className="py-1.5 flex items-start gap-2">
                      <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: colorOf(n.id) }} aria-hidden />
                      <span className="flex-1 min-w-0 text-sm text-gray-700">
                        {n.name}{n.archived && <span className="text-[10px] text-gray-400"> (archivé)</span>}
                        {s && <StatDetails s={s} />}
                      </span>
                      {s ? (
                        <span className="text-right">
                          <span className="block text-sm font-semibold text-gray-900 tabular-nums">{fmt(s.followers)}</span>
                          <DeltaBadge stats={stats} networkId={n.id} year={year} month={month} />
                        </span>
                      ) : <span className="text-gray-300 text-sm">—</span>}
                    </li>
                  );
                })}
              </ul>
              {openComments[key] && (
                <ul className="mt-2 space-y-1 text-sm rounded bg-gray-50 p-2" data-testid={`commentaires-${key}`}>
                  {comments.map(({ n, s }) => (
                    <li key={n.id}><span className="font-medium text-gray-700">{n.name} :</span> <span className="text-gray-600 whitespace-pre-line">{s.comment}</span></li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Onglet
// ---------------------------------------------------------------------------

export default function SocialTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { state, saveSocialStats } = useApp();
  const toast = useToast();
  const now = new Date();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(now.getMonth() + 1);
  // Brouillon : cartes modifiées (clé réseau|année|mois), conservé en changeant de mois.
  const [drafts, setDrafts] = useState<Record<string, StatDraft>>({});
  const [errors, setErrors] = useState<Record<string, DraftError[]>>({});
  const [manageOpen, setManageOpen] = useState(false);

  const networks = useMemo(() => state.socialNetworks ?? [], [state.socialNetworks]);
  const stats = useMemo(() => state.socialStats ?? [], [state.socialStats]);
  const ordered = orderedNetworks(networks);
  const colorOf = (id: string) => COLORS[Math.max(0, ordered.findIndex(n => n.id === id)) % COLORS.length];
  const inSaisie = activeNetworks(networks);
  const inHistory = historyNetworks(networks, stats);

  // Modifié = au moins une carte dont le contenu diffère de ce qui est enregistré.
  const dirty = Object.entries(drafts).some(([key, d]) => {
    const [networkId, y, m] = key.split('|');
    return JSON.stringify(d) !== JSON.stringify(draftFromStat(findStat(stats, networkId, Number(y), Number(m))));
  });

  // Garde anti-perte (même mécanisme que l'onglet Saisie) : changement d'onglet + fermeture.
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const keyOf = (networkId: string) => `${networkId}|${year}|${month}`;
  const draftOf = (networkId: string) => drafts[keyOf(networkId)] ?? draftFromStat(findStat(stats, networkId, year, month));
  const change = (networkId: string, d: StatDraft) => {
    setDrafts(prev => ({ ...prev, [keyOf(networkId)]: d }));
    if (errors[keyOf(networkId)]) setErrors(prev => { const next = { ...prev }; delete next[keyOf(networkId)]; return next; });
  };

  const goPrev = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const goNext = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const handleSave = () => {
    const result = buildSave(stats, drafts, generateId);
    if (Object.keys(result.errors).length) {
      setErrors(result.errors);
      const first = Object.keys(result.errors)[0].split('|');
      const net = networks.find(n => n.id === first[0]);
      toast.error(`À corriger avant d'enregistrer : ${net?.name ?? 'réseau'} (${monthLabel(Number(first[1]), Number(first[2]))}). Rien n'a été enregistré.`);
      if (Number(first[1]) !== year || Number(first[2]) !== month) { setYear(Number(first[1])); setMonth(Number(first[2])); }
      return;
    }
    if (result.rows.length) {
      saveSocialStats(result.rows);
      const months = new Set(result.rows.map(r => `${r.year}-${r.month}`)).size;
      toast.success(`${result.rows.length} réseau${result.rows.length > 1 ? 'x' : ''} enregistré${result.rows.length > 1 ? 's' : ''}${months > 1 ? ` sur ${months} mois` : ''}`);
    }
    setDrafts({});
    setErrors({});
  };

  const editMonth = (y: number, m: number) => {
    setYear(y);
    setMonth(m);
    document.getElementById('saisie-reseaux')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const series = useMemo(() => followersSeries(stats, inHistory), [stats, inHistory]);
  const pendingOtherMonths = new Set(Object.entries(drafts)
    .filter(([key]) => !key.endsWith(`|${year}|${month}`))
    .filter(([key, d]) => { const [n, y, m] = key.split('|'); return JSON.stringify(d) !== JSON.stringify(draftFromStat(findStat(stats, n, Number(y), Number(m)))); })
    .map(([key]) => { const [, y, m] = key.split('|'); return monthLabel(Number(y), Number(m)); })).size;

  return (
    <div className="space-y-6">
      {/* Navigation mois + année + enregistrer (même barre que la Saisie) */}
      <div id="saisie-reseaux" className="flex items-center justify-between flex-wrap gap-3 scroll-mt-4">
        <div className="flex items-center gap-2">
          <button onClick={goPrev} className="btn-ghost btn-sm" aria-label="Mois précédent"><ChevronLeft className="w-4 h-4" /></button>
          <div className="text-base font-semibold text-gray-900 min-w-[150px] text-center" data-testid="mois-affiche">{MONTHS[month - 1]} {year}</div>
          <button onClick={goNext} className="btn-ghost btn-sm" aria-label="Mois suivant"><ChevronRight className="w-4 h-4" /></button>
          <select className="select w-auto ml-2" value={year} onChange={e => setYear(Number(e.target.value))} aria-label="Année">
            {(YEAR_OPTIONS.includes(year) ? YEAR_OPTIONS : [...YEAR_OPTIONS, year].sort()).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button onClick={handleSave} className={`btn-primary btn-sm ${dirty ? 'animate-pulse' : ''}`} disabled={!dirty}>
          <Save className="w-4 h-4" /> Enregistrer
        </button>
      </div>
      {pendingOtherMonths > 0 && (
        <p className="text-xs text-warning-700 -mt-4">Modifications en attente sur {pendingOtherMonths} autre{pendingOtherMonths > 1 ? 's' : ''} mois : « Enregistrer » les enregistre aussi.</p>
      )}

      {/* Saisie du mois */}
      <section aria-labelledby="titre-saisie-reseaux" className="space-y-3">
        <div>
          <h3 id="titre-saisie-reseaux" className="text-sm font-semibold text-gray-900">Saisie — {MONTHS[month - 1]} {year}</h3>
          <p className="text-xs text-gray-400 mt-0.5">Abonnés obligatoires ; publications, portée et commentaire facultatifs. Une carte laissée vide n&apos;enregistre rien. Un mois déjà enregistré se corrige ici.</p>
        </div>
        {inSaisie.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {inSaisie.map(n => (
              <NetworkCard key={`${n.id}-${year}-${month}`} network={n} color={colorOf(n.id)} draft={draftOf(n.id)} saved={findStat(stats, n.id, year, month)}
                errors={errors[keyOf(n.id)]} stats={stats} year={year} month={month} onChange={d => change(n.id, d)} />
            ))}
          </div>
        ) : <p className="text-sm text-gray-400">Aucun réseau actif : réactivez-en un ou ajoutez-en un ci-dessous.</p>}
      </section>

      {/* Gestion des réseaux */}
      <Repliable
        open={manageOpen}
        onToggle={() => setManageOpen(o => !o)}
        label="la gestion des réseaux"
        className="card px-4 py-2"
        title={<span className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2"><Settings2 className="w-4 h-4 text-gray-500" /> Gérer les réseaux <span className="font-normal text-gray-400">({inSaisie.length} actif{inSaisie.length > 1 ? 's' : ''}{networks.length > inSaisie.length ? `, ${networks.length - inSaisie.length} archivé${networks.length - inSaisie.length > 1 ? 's' : ''}` : ''})</span></span>}
      >
        <NetworksManager networks={ordered} colorOf={colorOf} />
      </Repliable>

      {/* Courbe des abonnés */}
      {series.length > 0 && (
        <div className="card p-5" data-testid="courbe-abonnes">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Évolution des abonnés</h3>
          <Suspense fallback={<div className="h-[260px] animate-pulse bg-gray-50 rounded" />}>
            <FollowersChart data={series} networks={inHistory} colorOf={colorOf} />
          </Suspense>
        </div>
      )}

      {/* Historique */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-gray-400" aria-hidden />
          <h3 className="text-sm font-semibold text-gray-900">Historique mois par mois</h3>
        </div>
        <div className="p-3 sm:p-0">
          <History stats={stats} networks={inHistory} colorOf={colorOf} onEdit={editMonth} />
        </div>
      </div>

      {/* Cartes invalides sur un autre mois que celui affiché */}
      {Object.keys(errors).length > 0 && !Object.keys(errors).some(k => k.endsWith(`|${year}|${month}`)) && (
        <p className="text-xs text-danger-700" role="alert">Des cartes d&apos;un autre mois sont à corriger.</p>
      )}
    </div>
  );
}
