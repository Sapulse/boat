import { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { Search, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { useApp } from '../context/useApp';
import { StatusBadge, TemperatureBadge, AlertDot } from '../components/ui/StatusBadge';
import { formatCurrency, getAlertLevel, getLeadFullName, leadMatchesSearch, daysSince, cn } from '../lib/utils';
import { BOAT_TYPES, BOAT_CONDITIONS, SOURCES, TEMPERATURES, NO_COMMERCIAL_FILTER } from '../data/constants';
import type { Lead, LeadStatus } from '../data/types';

const PRIMARY_STATUSES: LeadStatus[] = ['nouveau', 'a_contacter', 'contacte', 'qualifie', 'devis_envoye', 'negociation', 'en_conclusion'];
const SECONDARY_STATUSES: LeadStatus[] = ['signe', 'perdu', 'reporte'];

function LeadCard({ lead, overlay }: { lead: Lead; overlay?: boolean }) {
  const { getCommercialName } = useApp();
  const alert = getAlertLevel(lead);
  const days = daysSince(lead.lastActionDate || lead.createdAt);

  return (
    <div className={cn(
      'bg-white rounded-lg border border-gray-200 p-3 space-y-2 cursor-grab active:cursor-grabbing transition-shadow',
      overlay ? 'shadow-lg ring-2 ring-primary-400/50 rotate-2' : 'shadow-sm hover:shadow-md'
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <AlertDot level={alert} />
          <span className="text-sm font-medium text-gray-900 truncate">{getLeadFullName(lead)}</span>
        </div>
        <TemperatureBadge temperature={lead.temperature} />
      </div>
      {lead.boatInterest && (
        <p className="text-xs text-gray-500 truncate">{lead.boatInterest}</p>
      )}
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500">{getCommercialName(lead.commercialId)}</span>
        <span className="font-semibold text-gray-700">{formatCurrency(lead.budget)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{[lead.boatType, lead.boatCondition].filter(Boolean).join(' · ')}</span>
        <span className={cn(days > 14 ? 'text-danger-600' : days > 7 ? 'text-warning-600' : '')}>
          {days === Infinity ? '' : days === 0 ? "Auj." : `${days}j`}
        </span>
      </div>
    </div>
  );
}

// Seuil (px) en deca duquel un relachement est considere comme un clic et non un
// drag. Superieur au seuil d'activation du PointerSensor (5px) pour qu'un vrai
// drag (qui depasse forcement 5px) ne declenche jamais la navigation.
const CLICK_MOVE_THRESHOLD = 6;

// Carte = PUR draggable (useDraggable), PAS une cible de drop : il n'y a aucun
// tri intra-colonne a persister, et des cartes-cibles + closestCorners
// faisaient parfois resoudre le drop vers une carte d'une colonne VOISINE
// (mauvais statut applique). Les colonnes sont les seules droppables ->
// le statut applique est toujours celui de la colonne visee.
// Pas de transform sur la source : le DragOverlay porte le visuel du
// deplacement, la source reste en place a 30% d'opacite.
function DraggableCard({ lead }: { lead: Lead }) {
  const navigate = useNavigate();
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    data: { type: 'lead', lead },
  });

  // onPointerDownCapture s'execute en phase capture, AVANT le onPointerDown des
  // listeners dnd, sans le remplacer -> on memorise l'origine du geste sans
  // casser le drag. Au clic, on ne navigue que si le pointeur a peu bouge.
  const handleClick = (e: React.MouseEvent) => {
    const start = pointerDownAt.current;
    pointerDownAt.current = null;
    if (!start) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (moved < CLICK_MOVE_THRESHOLD) navigate(`/leads/${lead.id}`);
  };

  return (
    <div
      ref={setNodeRef}
      // touch-action manipulation : pan/scroll natifs autorises (le TouchSensor
      // n'active le drag qu'apres appui long), mais double-tap zoom desactive
      // sur les cartes (evite le delai de 300ms et les zooms accidentels).
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: 'manipulation' }}
      {...attributes}
      {...listeners}
      onPointerDownCapture={e => { pointerDownAt.current = { x: e.clientX, y: e.clientY }; }}
      onClick={handleClick}
    >
      <LeadCard lead={lead} />
    </div>
  );
}

// Detection de collision : la colonne SOUS LE POINTEUR d'abord (precis,
// previsible — c'est la colonne que l'utilisateur vise), sinon l'intersection
// de rectangles en secours (lacher en bordure). Aucune cible -> drop annule.
const columnCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

function Column({ status, leads, collapsed, onToggle }: { status: LeadStatus; leads: Lead[]; collapsed: boolean; onToggle: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { type: 'column', status } });
  const total = leads.reduce((sum, l) => sum + (l.budget ?? 0), 0);
  const isSecondary = SECONDARY_STATUSES.includes(status);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-xl shrink-0 transition-colors',
        isSecondary ? 'bg-gray-50/80 min-w-[200px] w-[220px]' : 'bg-gray-100/80 min-w-[260px] w-[280px]',
        isOver && 'bg-primary-50 ring-2 ring-primary-300/50'
      )}
    >
      <div className="px-3 py-3 border-b border-gray-200/60">
        <div className="flex items-center justify-between mb-1">
          <StatusBadge status={status} />
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500 bg-white px-2 py-0.5 rounded-full">
              {leads.length}
            </span>
            <button onClick={onToggle} className="p-0.5 text-gray-400 hover:text-gray-600 rounded">
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-1">{formatCurrency(total)}</p>
      </div>
      {!collapsed && (
        <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)]">
          {leads.map(lead => (
            <DraggableCard key={lead.id} lead={lead} />
          ))}
          {leads.length === 0 && (
            <div className="text-xs text-gray-400 text-center py-8">Aucun lead</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PipelinePage() {
  const { state, updateLeadStatus } = useApp();
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterCommercial, setFilterCommercial] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterBoatType, setFilterBoatType] = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [filterTemp, setFilterTemp] = useState('');
  const [filterAlert, setFilterAlert] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Souris : drag des 5px (comportement historique). Tactile : APPUI LONG
  // (250ms, tolerance 8px) pour demarrer un drag — un glissement court reste
  // un SCROLL du board. PointerSensor seul rendait le scroll au doigt
  // impossible (tout glissement >5px sur une carte devenait un drag).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  const validCommercialIds = useMemo(() => new Set(state.commercials.map(c => c.id)), [state.commercials]);
  const hasOrphanLeads = useMemo(() => state.leads.some(l => !validCommercialIds.has(l.commercialId)), [state.leads, validCommercialIds]);

  const filteredLeads = useMemo(() => {
    let leads = [...state.leads];
    if (search) {
      leads = leads.filter(l => leadMatchesSearch(l, search));
    }
    if (filterCommercial === NO_COMMERCIAL_FILTER) leads = leads.filter(l => !validCommercialIds.has(l.commercialId));
    else if (filterCommercial) leads = leads.filter(l => l.commercialId === filterCommercial);
    if (filterSource) leads = leads.filter(l => l.source === filterSource);
    if (filterBoatType) leads = leads.filter(l => l.boatType === filterBoatType);
    if (filterCondition) leads = leads.filter(l => l.boatCondition === filterCondition);
    if (filterTemp) leads = leads.filter(l => l.temperature === filterTemp);
    if (filterAlert) leads = leads.filter(l => getAlertLevel(l) === filterAlert);
    return leads;
  }, [state.leads, search, filterCommercial, filterSource, filterBoatType, filterCondition, filterTemp, filterAlert, validCommercialIds]);

  const allStatuses = [...PRIMARY_STATUSES, ...SECONDARY_STATUSES];

  const leadsByStatus = allStatuses.reduce((acc, status) => {
    acc[status] = filteredLeads.filter(l => l.status === status);
    return acc;
  }, {} as Record<LeadStatus, Lead[]>);

  const hasFilters = filterCommercial || filterSource || filterBoatType || filterCondition || filterTemp || filterAlert;

  const handleDragStart = (event: DragStartEvent) => {
    const lead = state.leads.find(l => l.id === event.active.id);
    if (lead) setActiveLead(lead);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveLead(null);
    const { active, over } = event;
    if (!over) return;

    // Les colonnes sont les SEULES cibles droppables : `over` est forcement
    // une colonne, le statut applique est toujours celui de la colonne visee.
    const newStatus = over.data?.current?.status as LeadStatus | undefined;
    if (!newStatus) return;

    const currentLead = state.leads.find(l => l.id === active.id);
    if (currentLead && currentLead.status !== newStatus) {
      updateLeadStatus(currentLead.id, newStatus);
    }
  };

  // Drag annule (Echap, perte du pointeur) : sans ce handler, l'overlay
  // fantome de la carte restait affiche jusqu'au drag suivant.
  const handleDragCancel = () => {
    setActiveLead(null);
  };

  const toggleCollapsed = (status: LeadStatus) => {
    setCollapsed(prev => ({ ...prev, [status]: !prev[status] }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="input pl-9 text-sm" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button onClick={() => setShowFilters(!showFilters)} className={cn('btn-secondary btn-sm', showFilters && 'bg-primary-50 border-primary-300 text-primary-700')}>
          <Filter className="w-4 h-4" /> Filtres
          {hasFilters && <span className="bg-primary-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">!</span>}
        </button>
        {hasFilters && (
          <button onClick={() => { setFilterCommercial(''); setFilterSource(''); setFilterBoatType(''); setFilterCondition(''); setFilterTemp(''); setFilterAlert(''); }} className="btn-ghost btn-sm text-xs text-gray-500">
            Réinitialiser
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{filteredLeads.length} leads</span>
      </div>

      {showFilters && (
        <div className="card p-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <select className="select text-xs" value={filterCommercial} onChange={e => setFilterCommercial(e.target.value)}>
              <option value="">Commercial</option>
              {state.commercials.map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? '' : ' (inactif)'}</option>)}
              {hasOrphanLeads && <option value={NO_COMMERCIAL_FILTER}>— sans commercial</option>}
            </select>
            <select className="select text-xs" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
              <option value="">Source</option>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="select text-xs" value={filterBoatType} onChange={e => setFilterBoatType(e.target.value)}>
              <option value="">Type</option>
              {BOAT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="select text-xs" value={filterCondition} onChange={e => setFilterCondition(e.target.value)}>
              <option value="">État</option>
              {BOAT_CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="select text-xs" value={filterTemp} onChange={e => setFilterTemp(e.target.value)}>
              <option value="">Température</option>
              {TEMPERATURES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select className="select text-xs" value={filterAlert} onChange={e => setFilterAlert(e.target.value)}>
              <option value="">Urgence</option>
              <option value="orange">Orange</option>
              <option value="red">Rouge</option>
            </select>
          </div>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={columnCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 lg:-mx-6 lg:px-6">
          {PRIMARY_STATUSES.map(status => (
            <Column key={status} status={status} leads={leadsByStatus[status]} collapsed={!!collapsed[status]} onToggle={() => toggleCollapsed(status)} />
          ))}
          <div className="w-px bg-gray-300 shrink-0 mx-1" />
          {SECONDARY_STATUSES.map(status => (
            <Column key={status} status={status} leads={leadsByStatus[status]} collapsed={!!collapsed[status]} onToggle={() => toggleCollapsed(status)} />
          ))}
        </div>
        <DragOverlay>
          {activeLead && <LeadCard lead={activeLead} overlay />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
