import { useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, AlertTriangle, CalendarDays } from 'lucide-react';
import {
  startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, format, isSameDay,
  startOfMonth, endOfMonth, addMonths, subMonths, isSameMonth, addDays, subDays,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  DndContext, MouseSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable,
  pointerWithin, rectIntersection, type CollisionDetection, type DragEndEvent,
} from '@dnd-kit/core';
import { useApp } from '../context/useApp';
import Modal from '../components/ui/Modal';
import { ACTION_TYPES } from '../data/constants';
import { cn, toISODate, formatDate, getLeadFullName } from '../lib/utils';
import { activateOnKey } from '../lib/a11y';
import {
  buildAgendaEvents, groupEventsByDay, getCommercialColor, getCreatableLeads,
  buildTimeSlots, layoutDayEvents,
  type AgendaEvent, type CommercialColor, type DayLayout,
} from '../lib/agenda';
import type { Commercial, ActionType, Lead } from '../data/types';

type AgendaView = 'semaine' | 'mois' | 'jour';

const VIEWS: { value: AgendaView; label: string }[] = [
  { value: 'semaine', label: 'Semaine' },
  { value: 'mois', label: 'Mois' },
  { value: 'jour', label: 'Journée' },
];

// Seuil (px) en deca duquel un relachement est un CLIC (-> fiche) et non un drag.
// Superieur au seuil d'activation du MouseSensor (5px) : un vrai drag ne navigue
// jamais. Meme logique que le Kanban (PipelinePage).
const CLICK_MOVE_THRESHOLD = 6;

// Collision : la cellule SOUS LE POINTEUR d'abord (precise), sinon intersection
// de rectangles en secours (lacher en bordure). Aucune cible -> drop annule.
const dayCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

function actionLabel(type: AgendaEvent['type']): string {
  return ACTION_TYPES.find(a => a.value === type)?.label ?? 'Action';
}

// onReplan : deplace une action existante (type PRESERVE, date changee) via
// setNextAction. onCreate : ouvre le createur pour une date donnee.
type OnReplan = (event: AgendaEvent, newDate: string) => void;
// Ouvre le createur pour une date + heure (heure absente = "toute la journee").
type OnCreate = (dateISO: string, timeHHmm?: string) => void;

export default function AgendaPage() {
  const { state, setNextAction } = useApp();
  const navigate = useNavigate();

  const [view, setView] = useState<AgendaView>('semaine');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [filterCommercial, setFilterCommercial] = useState('');
  const [createSlot, setCreateSlot] = useState<{ date: string; time?: string } | null>(null);

  const todayISO = toISODate(new Date());

  // Evenements (prochaines actions des leads actifs), indexes par jour, filtres
  // par commercial. Memo : recalcul seulement si leads / filtre changent.
  const byDay = useMemo(() => {
    const events = buildAgendaEvents(state.leads, todayISO)
      .filter(e => !filterCommercial || e.commercialId === filterCommercial);
    return groupEventsByDay(events);
  }, [state.leads, filterCommercial, todayISO]);

  const activeCommercials = state.commercials.filter(c => c.active);
  const onOpen = (id: string) => navigate(`/leads/${id}`);
  // Replanification = on change UNIQUEMENT la date ; type ET heure preserves.
  const onReplan: OnReplan = (event, newDate) => setNextAction(event.leadId, event.type, newDate, event.time);
  const onCreate: OnCreate = (dateISO, timeHHmm) => setCreateSlot({ date: dateISO, time: timeHHmm });
  // L'heure finale vient du createur (pre-remplie depuis le creneau, modifiable).
  const doCreate = (leadId: string, type: ActionType, timeHHmm?: string) => {
    if (createSlot) setNextAction(leadId, type, createSlot.date, timeHHmm);
    setCreateSlot(null);
  };

  return (
    <div className="space-y-4">
      {/* En-tete : titre + commutateur de vues + filtre commercial */}
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary-600" /> Agenda
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Prochaines actions planifiées des leads, par commercial. Cliquez une date pour planifier, glissez (ou changez la date) pour replanifier.
          </p>
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
            {VIEWS.map(v => (
              <button
                key={v.value}
                onClick={() => setView(v.value)}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  view === v.value ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
          <select className="select text-sm" value={filterCommercial} onChange={e => setFilterCommercial(e.target.value)}>
            <option value="">Tous les commerciaux</option>
            {activeCommercials.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* Legende des couleurs par commercial */}
      <CommercialLegend />

      {view === 'semaine' && (
        <WeekView anchor={anchor} setAnchor={setAnchor} byDay={byDay} onOpen={onOpen} onCreate={onCreate} onReplan={onReplan} />
      )}
      {view === 'mois' && (
        <MonthView anchor={anchor} setAnchor={setAnchor} byDay={byDay} onOpen={onOpen} onCreate={onCreate} onReplan={onReplan} />
      )}
      {view === 'jour' && (
        <DayView
          anchor={anchor}
          setAnchor={setAnchor}
          byDay={byDay}
          columns={filterCommercial ? activeCommercials.filter(c => c.id === filterCommercial) : activeCommercials}
          onOpen={onOpen}
          onCreate={onCreate}
          onReplan={onReplan}
        />
      )}

      {createSlot !== null && (
        <CreateActionModal dateISO={createSlot.date} initialTime={createSlot.time} leads={state.leads} onClose={() => setCreateSlot(null)} onCreate={doCreate} />
      )}
    </div>
  );
}

// --- Legende : pastille de couleur par commercial actif (position = couleur) ---
function CommercialLegend() {
  const { state } = useApp();
  const active = state.commercials.filter(c => c.active);
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600">
      {active.map(c => {
        const color = getCommercialColor(c.id, state.commercials);
        return (
          <span key={c.id} className="inline-flex items-center gap-1.5">
            <span className={cn('w-2.5 h-2.5 rounded-full', color.dot)} />
            {c.name}
          </span>
        );
      })}
    </div>
  );
}

// --- Pastille evenement : classes communes (couleur commercial + echu) ---
function chipClasses(color: CommercialColor, overdue: boolean, compact: boolean): string {
  return cn(
    compact ? 'rounded px-1 py-0.5 text-[10px]' : 'rounded-md px-1.5 py-1 text-[11px]',
    'w-full flex items-center gap-1 border leading-tight transition-shadow hover:shadow-sm cursor-pointer',
    color.bg, color.text, color.border,
    overdue && 'ring-1 ring-danger-400'
  );
}

function EventChipInner({ event, compact }: { event: AgendaEvent; compact: boolean }) {
  const overdue = event.status === 'overdue';
  if (compact) {
    return (
      <span className="flex-1 min-w-0 flex items-center gap-1">
        {overdue && <AlertTriangle className="w-2.5 h-2.5 text-danger-600 shrink-0" />}
        {event.time && <span className="font-semibold shrink-0">{event.time}</span>}
        <span className="truncate">{event.leadName}</span>
      </span>
    );
  }
  return (
    <span className="flex-1 min-w-0">
      <span className="flex items-center gap-1 font-medium">
        {overdue && <AlertTriangle className="w-3 h-3 text-danger-600 shrink-0" />}
        <span className="truncate">{event.time ? `${event.time} · ${actionLabel(event.type)}` : actionLabel(event.type)}</span>
      </span>
      <span className="block truncate text-gray-600">{event.leadName}</span>
    </span>
  );
}

function chipTitle(event: AgendaEvent): string {
  const prefix = event.time ? `${event.time} · ` : '';
  return `${prefix}${actionLabel(event.type)} — ${event.leadName}${event.status === 'overdue' ? ' (échu)' : ''}`;
}

// Bouton de replanification : ouvre le selecteur de date natif (showPicker) ;
// au changement, deplace l'action via onReplan (type preserve). stopPropagation
// pour ne declencher ni l'ouverture de fiche ni la creation sur la cellule.
function ReplanControl({ event, onReplan }: { event: AgendaEvent; onReplan: OnReplan }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="shrink-0" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        title="Replanifier (changer la date)"
        onClick={e => { e.stopPropagation(); ref.current?.showPicker?.(); }}
        className="p-0.5 rounded hover:bg-black/5"
      >
        <CalendarDays className="w-3 h-3" />
      </button>
      <input
        key={event.date}
        ref={ref}
        type="date"
        defaultValue={event.date}
        tabIndex={-1}
        onChange={e => { if (e.target.value) onReplan(event, e.target.value); }}
        className="sr-only"
      />
    </span>
  );
}

// Pastille NON draggable (Mois / Journee) : clic -> fiche, bouton -> replanifier.
function EventChip({ event, onOpen, compact = false, onReplan }: {
  event: AgendaEvent;
  onOpen: (leadId: string) => void;
  compact?: boolean;
  onReplan?: OnReplan;
}) {
  const { state } = useApp();
  const color = getCommercialColor(event.commercialId, state.commercials);
  const overdue = event.status === 'overdue';
  return (
    <div
      role="button"
      tabIndex={0}
      title={chipTitle(event)}
      onClick={e => { e.stopPropagation(); onOpen(event.leadId); }}
      onKeyDown={activateOnKey(() => onOpen(event.leadId))}
      className={chipClasses(color, overdue, compact)}
    >
      <EventChipInner event={event} compact={compact} />
      {onReplan && <ReplanControl event={event} onReplan={onReplan} />}
    </div>
  );
}

// Pastille DRAGGABLE (Semaine) : glisser -> autre jour (replan) ; clic court ->
// fiche. transform construit a la main (@dnd-kit/utilities a ete retire).
function DraggableEvent({ event, onOpen, compact = false }: { event: AgendaEvent; onOpen: (leadId: string) => void; compact?: boolean }) {
  const { state } = useApp();
  const color = getCommercialColor(event.commercialId, state.commercials);
  const overdue = event.status === 'overdue';
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: event.leadId,
    data: { event },
  });

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const start = pointerDownAt.current;
    pointerDownAt.current = null;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= CLICK_MOVE_THRESHOLD) return;
    onOpen(event.leadId);
  };

  return (
    <div
      ref={setNodeRef}
      title={chipTitle(event)}
      onPointerDownCapture={e => { pointerDownAt.current = { x: e.clientX, y: e.clientY }; }}
      onClick={handleClick}
      onKeyDown={activateOnKey(() => onOpen(event.leadId))}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        opacity: isDragging ? 0.5 : 1,
        touchAction: 'manipulation',
        zIndex: isDragging ? 50 : undefined,
      }}
      {...attributes}
      {...listeners}
      className={chipClasses(color, overdue, compact)}
    >
      <EventChipInner event={event} compact={compact} />
    </div>
  );
}

function ViewNav({ onPrev, onToday, onNext, label, prevLabel, nextLabel, today }: {
  onPrev: () => void; onToday: () => void; onNext: () => void;
  label: string; prevLabel: string; nextLabel: string; today?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onPrev} className="btn-secondary btn-sm" aria-label={prevLabel}><ChevronLeft className="w-4 h-4" /></button>
      <button onClick={onToday} className="btn-secondary btn-sm">Aujourd'hui</button>
      <button onClick={onNext} className="btn-secondary btn-sm" aria-label={nextLabel}><ChevronRight className="w-4 h-4" /></button>
      <span className={cn('text-sm font-medium ml-2 capitalize', today ? 'text-primary-600' : 'text-gray-700')}>{label}</span>
    </div>
  );
}

// --- Vue SEMAINE en GRILLE HORAIRE : 7 colonnes jour x heures ---
// Drag NIVEAU JOUR : glisser vers une cellule d'un autre jour change la date,
// l'heure est conservee (onReplan preserve event.time). Le changement d'heure
// par drag (drop par creneau) est un raffinement futur.
function WeekView({ anchor, setAnchor, byDay, onOpen, onCreate, onReplan }: {
  anchor: Date;
  setAnchor: (d: Date) => void;
  byDay: Map<string, AgendaEvent[]>;
  onOpen: (leadId: string) => void;
  onCreate: OnCreate;
  onReplan: OnReplan;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );
  const start = startOfWeek(anchor, { weekStartsOn: 1 });
  const end = endOfWeek(anchor, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });
  const rangeLabel = `${format(start, 'd MMM', { locale: fr })} – ${format(end, 'd MMM yyyy', { locale: fr })}`;
  const slots = buildTimeSlots();

  const gridColumns: GridColumn[] = days.map(day => {
    const dayISO = toISODate(day);
    const isToday = isSameDay(day, new Date());
    return {
      id: dayISO,
      header: <WeekDayHeader day={day} isToday={isToday} />,
      layout: layoutDayEvents(byDay.get(dayISO) ?? []),
    };
  });

  // Drop par cellule : l'id encode `${dayISO}#${slot}` ; on n'extrait que le
  // jour (drag niveau jour). L'heure de l'action suit (onReplan -> event.time).
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const ev = active.data.current?.event as AgendaEvent | undefined;
    const targetDay = String(over.id).split('#')[0];
    if (!ev || !targetDay || targetDay === ev.date) return;
    onReplan(ev, targetDay);
  };

  return (
    <div className="space-y-3">
      <ViewNav
        onPrev={() => setAnchor(subWeeks(anchor, 1))}
        onToday={() => setAnchor(new Date())}
        onNext={() => setAnchor(addWeeks(anchor, 1))}
        label={rangeLabel}
        prevLabel="Semaine précédente"
        nextLabel="Semaine suivante"
      />
      <DndContext sensors={sensors} collisionDetection={dayCollision} onDragEnd={handleDragEnd}>
        <TimeGrid
          slots={slots}
          columns={gridColumns}
          onOpen={onOpen}
          onReplan={onReplan}
          droppable
          renderEvent={e => <DraggableEvent event={e} onOpen={onOpen} compact />}
          onSlotClick={(colId, time) => onCreate(colId, time)}
        />
      </DndContext>
    </div>
  );
}

function WeekDayHeader({ day, isToday }: { day: Date; isToday: boolean }) {
  return (
    <div className="text-center">
      <div className="text-xs font-medium text-gray-500 capitalize">{format(day, 'EEE', { locale: fr })}</div>
      <div className={cn('text-sm', isToday ? 'font-bold text-primary-600' : 'text-gray-700')}>{format(day, 'd', { locale: fr })}</div>
    </div>
  );
}

// --- Vue MOIS : grille calendaire ; clic cellule -> creer, bouton -> replanifier ---
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTH_CELL_MAX = 3;

function MonthView({ anchor, setAnchor, byDay, onOpen, onCreate, onReplan }: {
  anchor: Date;
  setAnchor: (d: Date) => void;
  byDay: Map<string, AgendaEvent[]>;
  onOpen: (leadId: string) => void;
  onCreate: OnCreate;
  onReplan: OnReplan;
}) {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div className="space-y-3">
      <ViewNav
        onPrev={() => setAnchor(subMonths(anchor, 1))}
        onToday={() => setAnchor(new Date())}
        onNext={() => setAnchor(addMonths(anchor, 1))}
        label={format(anchor, 'MMMM yyyy', { locale: fr })}
        prevLabel="Mois précédent"
        nextLabel="Mois suivant"
      />
      <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">
        {WEEKDAY_LABELS.map(d => (
          <div key={d} className="bg-gray-50 py-1.5 text-center text-[11px] font-medium text-gray-500">{d}</div>
        ))}
        {days.map(day => {
          const dayISO = toISODate(day);
          const events = byDay.get(dayISO) ?? [];
          const inMonth = isSameMonth(day, anchor);
          const isToday = isSameDay(day, new Date());
          const shown = events.slice(0, MONTH_CELL_MAX);
          const extra = events.length - shown.length;
          return (
            <div
              key={dayISO}
              onClick={() => onCreate(dayISO)}
              title="Cliquer pour planifier une action"
              className={cn('bg-white min-h-[88px] p-1 flex flex-col cursor-pointer hover:bg-primary-50/30', !inMonth && 'bg-gray-50/60')}
            >
              <div className="flex justify-end">
                <span className={cn(
                  'text-[11px] w-5 h-5 inline-flex items-center justify-center rounded-full',
                  isToday ? 'bg-primary-600 text-white font-bold' : inMonth ? 'text-gray-700' : 'text-gray-300'
                )}>
                  {format(day, 'd', { locale: fr })}
                </span>
              </div>
              <div className="space-y-0.5 mt-0.5 flex-1">
                {shown.map(e => <EventChip key={e.leadId} event={e} onOpen={onOpen} onReplan={onReplan} compact />)}
                {extra > 0 && <p className="text-[10px] text-gray-400 pl-1">+{extra} de plus</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Grille horaire reutilisable (Journee maintenant, Semaine a l'etape 2) ---
// Gouttiere d'heures a gauche + N colonnes ; bandeau "toute la journee / hors
// plage" en haut (aucune action perdue) ; une ligne par creneau. Defilable en x.
const SLOT_PX = 40; // hauteur d'une ligne de creneau

interface GridColumn {
  id: string;
  header: React.ReactNode;
  layout: DayLayout;
}

// Cellule = cible de drop (Semaine). L'id encode `${colId}#${slot}` ; le drag
// etant au niveau JOUR ce lot, onDragEnd n'extrait que le colId (le jour).
function DroppableCell({ id, className, style, onClick, children }: {
  id: string; className?: string; style?: React.CSSProperties; onClick?: () => void; children?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} style={style} onClick={onClick} className={cn(className, isOver && 'bg-primary-50/60 ring-1 ring-inset ring-primary-300')}>
      {children}
    </div>
  );
}

// Grille horaire generique. `renderEvent` decide du rendu d'une pastille (Journee
// = EventChip + re-selecteur ; Semaine = DraggableEvent). `droppable` enrobe les
// cellules en cibles de drop (Semaine uniquement).
function TimeGrid({ slots, columns, onOpen, onReplan, renderEvent, droppable = false, onSlotClick }: {
  slots: string[];
  columns: GridColumn[];
  onOpen: (leadId: string) => void;
  onReplan: OnReplan;
  renderEvent?: (event: AgendaEvent) => React.ReactNode;
  droppable?: boolean;
  onSlotClick?: (colId: string, time?: string) => void;
}) {
  const templateCols = `3.5rem repeat(${columns.length}, minmax(8rem, 1fr))`;
  const hasBanner = columns.some(c => c.layout.allDay.length > 0 || c.layout.outOfRange.length > 0);
  const render = renderEvent ?? ((e: AgendaEvent) => <EventChip event={e} onOpen={onOpen} onReplan={onReplan} compact />);

  // Cellule de donnees : droppable (Semaine) ou simple div (Journee). Cliquable
  // si onSlotClick fourni (creation au creneau ; `time` undefined sur le bandeau
  // = action toute la journee). Les pastilles stoppent la propagation -> cliquer
  // une pastille n'ouvre pas le createur.
  const Cell = ({ colId, slotKey, time, className, children }: { colId: string; slotKey: string; time?: string; className: string; children?: React.ReactNode }) => {
    const handleClick = onSlotClick ? () => onSlotClick(colId, time) : undefined;
    const cls = cn(className, onSlotClick && 'cursor-pointer hover:bg-primary-50/30');
    return droppable
      ? <DroppableCell id={`${colId}#${slotKey}`} className={cls} style={{ minHeight: SLOT_PX }} onClick={handleClick}>{children}</DroppableCell>
      : <div className={cls} style={{ minHeight: SLOT_PX }} onClick={handleClick}>{children}</div>;
  };

  return (
    <div className="card p-0 overflow-x-auto">
      <div className="min-w-max">
        {/* En-tetes de colonnes (gouttiere vide + colonnes) */}
        <div className="grid sticky top-0 bg-white z-10 border-b border-gray-200" style={{ gridTemplateColumns: templateCols }}>
          <div className="border-r border-gray-100" />
          {columns.map(c => (
            <div key={c.id} className="px-2 py-2 border-r border-gray-100 last:border-r-0">{c.header}</div>
          ))}
        </div>

        {/* Bandeau "toute la journee" + hors-plage (jamais perdues) */}
        {hasBanner && (
          <div className="grid bg-gray-50/60 border-b border-gray-200" style={{ gridTemplateColumns: templateCols }}>
            <div className="px-1 py-1 text-[10px] text-gray-400 text-right pr-2 border-r border-gray-100 self-center">toute la j.</div>
            {columns.map(c => (
              <Cell key={c.id} colId={c.id} slotKey="__banner" className="p-1 space-y-1 border-r border-gray-100 last:border-r-0">
                {c.layout.allDay.map(e => <div key={e.leadId}>{render(e)}</div>)}
                {c.layout.outOfRange.map(e => <div key={e.leadId}>{render(e)}</div>)}
                {c.layout.allDay.length === 0 && c.layout.outOfRange.length === 0 && <span className="block text-[10px] text-gray-300">+</span>}
              </Cell>
            ))}
          </div>
        )}

        {/* Lignes de creneaux */}
        {slots.map(slot => (
          <div key={slot} className="grid" style={{ gridTemplateColumns: templateCols }}>
            <div className="px-1 text-[10px] text-gray-400 text-right pr-2 border-r border-t border-gray-100" style={{ minHeight: SLOT_PX }}>
              {slot.endsWith(':00') ? slot : ''}
            </div>
            {columns.map(c => {
              const cellEvents = c.layout.bySlot.get(slot) ?? [];
              return (
                <Cell key={c.id} colId={c.id} slotKey={slot} time={slot} className="border-r border-t border-gray-100 last:border-r-0 p-0.5 flex gap-0.5">
                  {cellEvents.map(e => (
                    <div key={e.leadId} className="flex-1 min-w-0">{render(e)}</div>
                  ))}
                </Cell>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Vue JOURNEE COMPARATIVE en GRILLE HORAIRE : heures x commerciaux ---
// (vue "reunion du lundi" + creneaux). Toutes les colonnes affichees meme vides.
// Un evenement dont le commercial n'est PAS dans les colonnes (desactive mais
// lead encore assigne, hors filtre) tombe dans "Autres" -> aucune action masquee.
function DayView({ anchor, setAnchor, byDay, columns, onOpen, onCreate, onReplan }: {
  anchor: Date;
  setAnchor: (d: Date) => void;
  byDay: Map<string, AgendaEvent[]>;
  columns: Commercial[];
  onOpen: (leadId: string) => void;
  onCreate: OnCreate;
  onReplan: OnReplan;
}) {
  const { state } = useApp();
  const dayISO = toISODate(anchor);
  const events = byDay.get(dayISO) ?? [];
  const isToday = isSameDay(anchor, new Date());
  const slots = buildTimeSlots();

  const colIds = new Set(columns.map(c => c.id));
  const orphans = events.filter(e => !colIds.has(e.commercialId));

  const gridColumns: GridColumn[] = columns.map(c => {
    const colEvents = events.filter(e => e.commercialId === c.id);
    const color = getCommercialColor(c.id, state.commercials);
    return {
      id: c.id,
      header: <ColumnHeader dot={color.dot} title={c.name} count={colEvents.length} />,
      layout: layoutDayEvents(colEvents),
    };
  });
  if (orphans.length > 0) {
    gridColumns.push({
      id: '__autres',
      header: <ColumnHeader dot="bg-gray-400" title="Autres" count={orphans.length} />,
      layout: layoutDayEvents(orphans),
    });
  }

  return (
    <div className="space-y-3">
      <ViewNav
        onPrev={() => setAnchor(subDays(anchor, 1))}
        onToday={() => setAnchor(new Date())}
        onNext={() => setAnchor(addDays(anchor, 1))}
        label={format(anchor, 'EEEE d MMMM yyyy', { locale: fr })}
        prevLabel="Jour précédent"
        nextLabel="Jour suivant"
        today={isToday}
      />
      {/* En Journee, les colonnes sont des COMMERCIAUX : la date de creation est
          toujours le jour affiche (anchor), pas le colId. */}
      <TimeGrid
        slots={slots}
        columns={gridColumns}
        onOpen={onOpen}
        onReplan={onReplan}
        onSlotClick={(_colId, time) => onCreate(dayISO, time)}
      />
    </div>
  );
}

function ColumnHeader({ dot, title, count }: { dot: string; title: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', dot)} />
      <span className="text-sm font-medium text-gray-800 truncate">{title}</span>
      <span className="text-xs text-gray-400 ml-auto shrink-0">{count}</span>
    </div>
  );
}

// --- Createur : lead ELIGIBLE (sans action) + type + heure (pre-remplie depuis
// le creneau clique, modifiable ; vide = action toute la journee) ---
function CreateActionModal({ dateISO, initialTime, leads, onClose, onCreate }: {
  dateISO: string;
  initialTime?: string;
  leads: Lead[];
  onClose: () => void;
  onCreate: (leadId: string, type: ActionType, timeHHmm?: string) => void;
}) {
  const { getCommercialName } = useApp();
  const eligible = useMemo(() => getCreatableLeads(leads), [leads]);
  const [leadId, setLeadId] = useState('');
  const [type, setType] = useState<ActionType>('appel');
  const [time, setTime] = useState(initialTime ?? '');

  return (
    <Modal open onClose={onClose} title={`Planifier une action — ${formatDate(dateISO)}`} size="sm">
      {eligible.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-sm text-gray-600">Tous les leads actifs ont déjà une action planifiée.</p>
          <p className="text-xs text-gray-400 mt-1">Pour déplacer une action existante, utilisez la replanification (glisser en vue Semaine, ou le bouton date).</p>
          <button onClick={onClose} className="btn-secondary btn-sm mt-4">Fermer</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="label">Lead</label>
            <select className="select" value={leadId} onChange={e => setLeadId(e.target.value)}>
              <option value="">— Choisir un lead —</option>
              {eligible.map(l => (
                <option key={l.id} value={l.id}>{getLeadFullName(l)} · {getCommercialName(l.commercialId)}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Type d'action</label>
              <select className="select" value={type} onChange={e => setType(e.target.value as ActionType)}>
                {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Heure (facultative)</label>
              <input className="input" type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="btn-secondary btn-sm">Annuler</button>
            <button onClick={() => onCreate(leadId, type, time || undefined)} disabled={!leadId} className="btn-primary btn-sm disabled:opacity-50">Planifier</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
