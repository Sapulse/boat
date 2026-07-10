import { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, AlertTriangle, CalendarDays, Trash2,
  Users, Palmtree, Plane, User, Tag, type LucideIcon,
} from 'lucide-react';
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
import { useSubmitLock } from '../hooks/useSubmitLock';
import Modal from '../components/ui/Modal';
import { ACTION_TYPES, CALENDAR_EVENT_CATEGORIES, getCategoryInfo, AGENDA_HOUR_START, AGENDA_SLOT_MIN, AGENDA_SCROLL_TO_HOUR } from '../data/constants';
import { cn, toISODate, formatDate, getLeadFullName } from '../lib/utils';
import { activateOnKey } from '../lib/a11y';
import {
  buildAgendaEvents, groupEventsByDay, getCommercialColor, getCreatableLeads,
  buildTimeSlots, layoutDayGrid, isEndAfterStart, startSlotIndex, shiftEventBySlots, resizeEventBySlots,
  type AgendaEvent, type DayGridLayout, type PositionedEvent,
} from '../lib/agenda';
import type { Commercial, ActionType, Lead, CalendarEvent, CalendarEventCategory } from '../data/types';

// Icone par categorie d'evenement libre (distinction visuelle vs actions de lead).
const CATEGORY_ICON: Record<CalendarEventCategory, LucideIcon> = {
  reunion: Users,
  conge: Palmtree,
  deplacement: Plane,
  perso: User,
  autre: Tag,
};

// Item unifie de la grille : action de lead OU evenement libre. Le layout
// (layoutDayGrid) et la grille (TimeGrid) operent dessus ; le rendu branche sur
// `kind`. Champs horaires a plat (date/time/endTime) pour le positionnement.
type GridItem =
  | { kind: 'lead'; id: string; date: string; time?: string; endTime?: string; lead: AgendaEvent }
  | { kind: 'event'; id: string; date: string; time?: string; endTime?: string; event: CalendarEvent };

function leadToItem(ev: AgendaEvent): GridItem {
  return { kind: 'lead', id: ev.leadId, date: ev.date, time: ev.time, endTime: ev.endTime, lead: ev };
}
function calToItem(ce: CalendarEvent): GridItem {
  return { kind: 'event', id: ce.id, date: ce.date, time: ce.time, endTime: ce.endTime, event: ce };
}
function itemCommercialId(item: GridItem): string | undefined {
  return item.kind === 'lead' ? item.lead.commercialId : item.event.commercialId;
}

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

// Libelle horaire d'un evenement : "" (all-day), "14:00" (ponctuel) ou
// "14:00–16:00" (avec duree).
function timeLabel(event: { time?: string; endTime?: string }): string {
  if (!event.time) return '';
  return event.endTime ? `${event.time}–${event.endTime}` : event.time;
}

// onReplan : re-selecteur de DATE d'une action de lead (type/heure/duree preserves).
type OnReplan = (event: AgendaEvent, newDate: string) => void;
// Drag par creneau d'un item (lead OU evenement) : la page calcule la cible
// (computeDrop) et route l'ecriture selon kind (setNextAction / updateCalendarEvent).
type OnItemMove = (item: GridItem, newDate: string, deltaY: number) => void;
// Redimensionnement (poignee bas) d'un item : seule la fin change. Route par kind.
type OnItemResize = (item: GridItem, slotDelta: number) => void;
// Ouvre le createur pour une date + heure (heure absente = "toute la journee").
type OnCreate = (dateISO: string, timeHHmm?: string) => void;

export default function AgendaPage() {
  const { state, setNextAction, addCalendarEvent, updateCalendarEvent, deleteCalendarEvent } = useApp();
  const navigate = useNavigate();

  const [view, setView] = useState<AgendaView>('semaine');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [filterCommercial, setFilterCommercial] = useState('');
  // Createur : clic-creneau -> choix (action de lead / evenement) puis la bonne modale.
  const [creator, setCreator] = useState<{ date: string; time?: string; mode: 'choose' | 'lead' | 'event' } | null>(null);
  // Edition d'un evenement libre existant (clic sur le bloc).
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);

  const todayISO = toISODate(new Date());

  // Items unifies (actions de leads + evenements libres), indexes par jour,
  // filtres par commercial. Memo : recalcul si leads / evenements / filtre changent.
  const byDay = useMemo(() => {
    const items: GridItem[] = [
      ...buildAgendaEvents(state.leads, todayISO).map(leadToItem),
      ...state.calendarEvents.map(calToItem),
    ].filter(it => !filterCommercial || itemCommercialId(it) === filterCommercial);
    return groupEventsByDay(items);
  }, [state.leads, state.calendarEvents, filterCommercial, todayISO]);

  const activeCommercials = state.commercials.filter(c => c.active);
  const onOpen = (id: string) => navigate(`/leads/${id}`);
  const onEditEvent = (event: CalendarEvent) => setEditEvent(event);
  // Replanification (re-selecteur de date) = on change UNIQUEMENT la date ; type,
  // heure ET duree preserves (leads, vue Journee).
  const onReplan: OnReplan = (event, newDate) => setNextAction(event.leadId, event.type, newDate, event.time, event.endTime);
  // Drag par creneau (lead OU evenement) : la page calcule la cible et route
  // l'ecriture selon kind. Lead -> SET_NEXT_ACTION ; evenement -> UPDATE_CALENDAR_EVENT.
  const onItemMove: OnItemMove = (item, newDate, deltaY) => {
    const drop = computeDrop(item, newDate, deltaY);
    if (!drop) return;
    if (item.kind === 'lead') setNextAction(item.lead.leadId, item.lead.type, drop.date, drop.time, drop.endTime);
    else updateCalendarEvent(item.event.id, { date: drop.date, time: drop.time, endTime: drop.endTime });
  };
  // Resize = seule la fin change (debut/jour fixes), min 1 creneau, clamp fin de plage.
  const onItemResize: OnItemResize = (item, slotDelta) => {
    if (item.kind === 'lead') {
      if (!item.lead.time) return;
      setNextAction(item.lead.leadId, item.lead.type, item.lead.date, item.lead.time, resizeEventBySlots(item.lead.time, item.lead.endTime, slotDelta));
    } else {
      if (!item.event.time) return;
      updateCalendarEvent(item.event.id, { endTime: resizeEventBySlots(item.event.time, item.event.endTime, slotDelta) });
    }
  };
  const onCreate: OnCreate = (dateISO, timeHHmm) => setCreator({ date: dateISO, time: timeHHmm, mode: 'choose' });
  // Action de lead : heure debut/fin viennent du createur (debut pre-rempli).
  const doCreate = (leadId: string, type: ActionType, timeHHmm?: string, endTimeHHmm?: string) => {
    if (creator) setNextAction(leadId, type, creator.date, timeHHmm, endTimeHHmm);
    setCreator(null);
  };
  // Evenement libre : creation (ADD) ou edition (UPDATE), + suppression.
  const saveEvent = (data: Omit<CalendarEvent, 'id'>) => {
    if (editEvent) updateCalendarEvent(editEvent.id, data);
    else addCalendarEvent(data);
    setCreator(null);
    setEditEvent(null);
  };
  const removeEvent = () => {
    // Confirmation cohérente avec les autres suppressions (lead, action, modèle).
    // Annulation -> on garde la modale ouverte.
    if (!editEvent) return;
    if (!confirm(`Supprimer l'événement « ${editEvent.title} » définitivement ?`)) return;
    deleteCalendarEvent(editEvent.id);
    setEditEvent(null);
    setCreator(null);
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
            Actions des leads et événements d'agenda, par commercial. Cliquez un créneau pour planifier, glissez pour replanifier.
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

      {/* Legende : couleurs commerciaux + categories d'evenement */}
      <CommercialLegend />

      {view === 'semaine' && (
        <WeekView anchor={anchor} setAnchor={setAnchor} byDay={byDay} onOpen={onOpen} onEditEvent={onEditEvent} onCreate={onCreate} onItemMove={onItemMove} onItemResize={onItemResize} />
      )}
      {view === 'mois' && (
        <MonthView anchor={anchor} setAnchor={setAnchor} byDay={byDay} onOpen={onOpen} onEditEvent={onEditEvent} onCreate={onCreate} onReplan={onReplan} />
      )}
      {view === 'jour' && (
        <DayView
          anchor={anchor}
          setAnchor={setAnchor}
          byDay={byDay}
          columns={filterCommercial ? activeCommercials.filter(c => c.id === filterCommercial) : activeCommercials}
          onOpen={onOpen}
          onEditEvent={onEditEvent}
          onCreate={onCreate}
          onReplan={onReplan}
          onItemMove={onItemMove}
          onItemResize={onItemResize}
        />
      )}

      {/* Createur : etape 1 = choix du type, puis la modale dediee */}
      {creator?.mode === 'choose' && (
        <Modal open onClose={() => setCreator(null)} title={`Planifier — ${formatDate(creator.date)}${creator.time ? ` à ${creator.time}` : ''}`} size="sm">
          <div className="space-y-2">
            <button onClick={() => setCreator(c => c && { ...c, mode: 'lead' })} className="btn-secondary w-full justify-start">Action de lead</button>
            <button onClick={() => setCreator(c => c && { ...c, mode: 'event' })} className="btn-secondary w-full justify-start">Événement (réunion, congé, déplacement…)</button>
          </div>
        </Modal>
      )}
      {creator?.mode === 'lead' && (
        <CreateActionModal dateISO={creator.date} initialTime={creator.time} leads={state.leads} onClose={() => setCreator(null)} onCreate={doCreate} />
      )}
      {(creator?.mode === 'event' || editEvent) && (
        <CalendarEventModal
          existing={editEvent}
          initialDate={editEvent ? editEvent.date : creator!.date}
          initialTime={editEvent ? editEvent.time : creator?.time}
          commercials={state.commercials}
          onSave={saveEvent}
          onDelete={editEvent ? removeEvent : undefined}
          onClose={() => { setCreator(null); setEditEvent(null); }}
        />
      )}
    </div>
  );
}

// --- Legende : couleur par commercial (actions de leads) + categories d'evenement ---
function CommercialLegend() {
  const { state } = useApp();
  const active = state.commercials.filter(c => c.active);
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
      <span className="text-gray-300">|</span>
      {CALENDAR_EVENT_CATEGORIES.map(cat => {
        const Icon = CATEGORY_ICON[cat.value];
        return (
          <span key={cat.value} className="inline-flex items-center gap-1 text-gray-500">
            <Icon className={cn('w-3 h-3', cat.text)} />
            {cat.label}
          </span>
        );
      })}
    </div>
  );
}

// --- Pastille evenement : classes communes (couleur commercial OU categorie) ---
function chipClasses(color: { bg: string; text: string; border: string; dot: string }, overdue: boolean, compact: boolean): string {
  return cn(
    compact ? 'rounded px-1 py-0.5 text-[10px]' : 'rounded-md px-1.5 py-1 text-[11px]',
    'w-full flex items-center gap-1 border leading-tight transition-shadow hover:shadow-sm cursor-pointer',
    color.bg, color.text, color.border,
    overdue && 'ring-1 ring-danger-400'
  );
}

function EventChipInner({ event, compact }: { event: AgendaEvent; compact: boolean }) {
  const overdue = event.status === 'overdue';
  const tl = timeLabel(event);
  if (compact) {
    return (
      <span className="flex-1 min-w-0 flex items-center gap-1">
        {overdue && <AlertTriangle className="w-2.5 h-2.5 text-danger-600 shrink-0" />}
        {tl && <span className="font-semibold shrink-0">{tl}</span>}
        <span className="truncate">{event.leadName}</span>
      </span>
    );
  }
  return (
    <span className="flex-1 min-w-0">
      <span className="flex items-center gap-1 font-medium">
        {overdue && <AlertTriangle className="w-3 h-3 text-danger-600 shrink-0" />}
        <span className="truncate">{tl ? `${tl} · ${actionLabel(event.type)}` : actionLabel(event.type)}</span>
      </span>
      <span className="block truncate text-gray-600">{event.leadName}</span>
    </span>
  );
}

function chipTitle(event: AgendaEvent): string {
  const tl = timeLabel(event);
  const prefix = tl ? `${tl} · ` : '';
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

// Contenu visuel d'un evenement libre (icone categorie + heure + titre).
function CalendarEventInner({ event }: { event: CalendarEvent }) {
  const Icon = CATEGORY_ICON[event.category ?? 'autre'];
  const tl = timeLabel(event);
  return (
    <span className="flex-1 min-w-0 flex items-center gap-1">
      <Icon className="w-3 h-3 shrink-0" />
      {tl && <span className="font-semibold shrink-0">{tl}</span>}
      <span className="truncate">{event.title}</span>
    </span>
  );
}

function calendarEventTitle(event: CalendarEvent): string {
  const tl = timeLabel(event);
  return `${getCategoryInfo(event.category).label} — ${event.title}${tl ? ` (${tl})` : ''}`;
}

// Pastille NON draggable d'un evenement libre (vue Mois) : clic -> modale d'edition.
function CalendarEventChip({ event, onOpen, compact = false }: { event: CalendarEvent; onOpen: (event: CalendarEvent) => void; compact?: boolean }) {
  return (
    <div
      role="button"
      tabIndex={0}
      title={calendarEventTitle(event)}
      onClick={e => { e.stopPropagation(); onOpen(event); }}
      onKeyDown={activateOnKey(() => onOpen(event))}
      className={chipClasses(getCategoryInfo(event.category), false, compact)}
    >
      <CalendarEventInner event={event} />
    </div>
  );
}

// Pastille DRAGGABLE unifiee (grille Semaine/Journee) : lead OU evenement libre.
// Glisser -> autre jour ET/OU creneau (route par kind cote page) ; clic court ->
// fiche (lead) ou modale (evenement). `onReplan` (leads, Journee) ajoute le
// re-selecteur de DATE. La drag-data porte le GridItem (handleDragEnd branche).
function DraggableGridItem({ item, onOpen, onEditEvent, onReplan, compact = false }: {
  item: GridItem;
  onOpen: (leadId: string) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onReplan?: OnReplan;
  compact?: boolean;
}) {
  const { state } = useApp();
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: item.id, data: { item } });

  const isLead = item.kind === 'lead';
  const color = isLead ? getCommercialColor(item.lead.commercialId, state.commercials) : getCategoryInfo(item.event.category);
  const overdue = isLead && item.lead.status === 'overdue';
  const open = () => isLead ? onOpen(item.lead.leadId) : onEditEvent(item.event);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const start = pointerDownAt.current;
    pointerDownAt.current = null;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= CLICK_MOVE_THRESHOLD) return;
    open();
  };

  return (
    <div
      ref={setNodeRef}
      title={isLead ? chipTitle(item.lead) : calendarEventTitle(item.event)}
      onPointerDownCapture={e => { pointerDownAt.current = { x: e.clientX, y: e.clientY }; }}
      onClick={handleClick}
      onKeyDown={activateOnKey(open)}
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
      {isLead ? <EventChipInner event={item.lead} compact={compact} /> : <CalendarEventInner event={item.event} />}
      {isLead && onReplan && <ReplanControl event={item.lead} onReplan={onReplan} />}
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
// Drag PAR CRENEAU : glisser change le JOUR (colonne) ET l'HEURE (deplacement
// vertical) ; la duree suit (computeDrop -> shiftEventBySlots). Un all-day /
// hors-plage ne change que de jour.
function WeekView({ anchor, setAnchor, byDay, onOpen, onEditEvent, onCreate, onItemMove, onItemResize }: {
  anchor: Date;
  setAnchor: (d: Date) => void;
  byDay: Map<string, GridItem[]>;
  onOpen: (leadId: string) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onCreate: OnCreate;
  onItemMove: OnItemMove;
  onItemResize: OnItemResize;
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
      layout: layoutDayGrid(byDay.get(dayISO) ?? []),
    };
  });

  // Chaque colonne = une droppable (id = jourISO) -> nouveau jour. delta.y ->
  // nouveau creneau (computeDrop). La duree est preservee, clamp dans la grille.
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over, delta } = e;
    if (!over) return;
    const item = active.data.current?.item as GridItem | undefined;
    if (!item) return;
    onItemMove(item, String(over.id), delta.y);
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
          droppable
          renderEvent={item => <DraggableGridItem item={item} onOpen={onOpen} onEditEvent={onEditEvent} compact />}
          onSlotClick={(colId, time) => onCreate(colId, time)}
          onResize={onItemResize}
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

function MonthView({ anchor, setAnchor, byDay, onOpen, onEditEvent, onCreate, onReplan }: {
  anchor: Date;
  setAnchor: (d: Date) => void;
  byDay: Map<string, GridItem[]>;
  onOpen: (leadId: string) => void;
  onEditEvent: (event: CalendarEvent) => void;
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
                {shown.map(item => item.kind === 'lead'
                  ? <EventChip key={item.id} event={item.lead} onOpen={onOpen} onReplan={onReplan} compact />
                  : <CalendarEventChip key={item.id} event={item.event} onOpen={onEditEvent} compact />)}
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

// Calcule la cible d'un drop : nouveau jour (via la colonne) + nouvelle heure
// (via le deplacement vertical delta.y -> creneaux). Renvoie null si rien ne
// change. Un evenement horodate dans la plage decale son heure (duree preservee,
// clamp grille) ; un all-day / hors-plage ne change QUE de jour.
function computeDrop(ev: { date: string; time?: string; endTime?: string }, newDate: string, deltaY: number): { date: string; time?: string; endTime?: string } | null {
  if (ev.time && startSlotIndex(ev.time) !== null) {
    const slotDelta = Math.round(deltaY / SLOT_PX);
    const { time, endTime } = shiftEventBySlots(ev.time, ev.endTime, slotDelta);
    if (newDate === ev.date && time === ev.time && endTime === ev.endTime) return null;
    return { date: newDate, time, endTime };
  }
  if (newDate === ev.date) return null;
  return { date: newDate, time: ev.time, endTime: ev.endTime };
}

interface GridColumn {
  id: string;
  header: React.ReactNode;
  layout: DayGridLayout<GridItem>;
}

// Colonne = corps relatif (Semaine : cible de drop unique au niveau JOUR). Les
// cellules-fond (clic-creation) et les blocs absolus vivent a l'interieur.
function DroppableColumn({ id, className, children }: { id: string; className?: string; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={cn(className, isOver && 'bg-primary-50/40')}>{children}</div>;
}

// Bloc positionne dans la grille : chip (deplacement/clic) + poignee de resize en
// bas (pointer events, apercu LIVE de la hauteur, commit au relachement). La
// poignee est SOEUR du chip -> son pointerdown ne declenche pas le drag du chip.
function GridBlock({ p, slotCount, render, onResize }: {
  p: PositionedEvent<GridItem>;
  slotCount: number;
  render: (item: GridItem) => React.ReactNode;
  onResize?: OnItemResize;
}) {
  const [liveDelta, setLiveDelta] = useState(0);
  const startY = useRef(0);
  const resizing = useRef(false);
  // Tout bloc positionne a une heure -> resize possible (lead ET evenement libre).
  const item = p.event;
  const resizable = !!onResize;

  const minDelta = 1 - p.span;                       // duree mini 1 creneau
  const maxDelta = slotCount - p.startIndex - p.span; // fin <= fin de plage
  const clampDelta = (d: number) => Math.min(Math.max(d, minDelta), maxDelta);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    resizing.current = true;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!resizing.current) return;
    setLiveDelta(clampDelta(Math.round((e.clientY - startY.current) / SLOT_PX)));
  };
  const endResize = (e: React.PointerEvent) => {
    if (!resizing.current) return;
    resizing.current = false;
    e.stopPropagation();
    const d = clampDelta(liveDelta);
    setLiveDelta(0);
    if (d !== 0 && onResize) onResize(item, d);
  };

  const span = Math.max(1, p.span + liveDelta);
  return (
    <div
      className="absolute p-0.5"
      style={{
        top: p.startIndex * SLOT_PX,
        height: span * SLOT_PX,
        left: `${(p.lane / p.lanes) * 100}%`,
        width: `${(1 / p.lanes) * 100}%`,
        zIndex: liveDelta !== 0 ? 40 : undefined,
      }}
    >
      <div className="relative h-full">
        <div className="h-full [&>*]:h-full">{render(item)}</div>
        {resizable && (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onClick={e => e.stopPropagation()}
            title="Étirer pour changer la durée"
            style={{ touchAction: 'none' }}
            className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize bg-black/5 hover:bg-black/20 rounded-b"
          />
        )}
      </div>
    </div>
  );
}

// Corps d'une colonne : cellules-fond empilees (hauteur de la grille + clic-
// creation par creneau) + blocs d'evenements en ABSOLU (GridBlock).
function ColumnBody({ col, slots, droppable, onSlotClick, render, onResize }: {
  col: GridColumn;
  slots: string[];
  droppable: boolean;
  onSlotClick?: (colId: string, time?: string) => void;
  render: (item: GridItem) => React.ReactNode;
  onResize?: OnItemResize;
}) {
  const inner = (
    <>
      {slots.map(slot => (
        <div
          key={slot}
          style={{ height: SLOT_PX }}
          onClick={onSlotClick ? () => onSlotClick(col.id, slot) : undefined}
          className={cn('border-r border-t border-gray-100', onSlotClick && 'cursor-pointer hover:bg-primary-50/30')}
        />
      ))}
      {col.layout.positioned.map(p => (
        <GridBlock key={p.event.id} p={p} slotCount={col.layout.slotCount} render={render} onResize={onResize} />
      ))}
    </>
  );
  return droppable
    ? <DroppableColumn id={col.id} className="relative">{inner}</DroppableColumn>
    : <div className="relative">{inner}</div>;
}

// Grille horaire generique (column-major). `renderEvent` decide du rendu d'un
// bloc (Journee = EventChip + re-selecteur ; Semaine = DraggableEvent).
// `droppable` fait de chaque colonne UNE cible de drop (drag niveau jour).
function TimeGrid({ slots, columns, renderEvent, droppable = false, onSlotClick, onResize }: {
  slots: string[];
  columns: GridColumn[];
  renderEvent: (item: GridItem) => React.ReactNode;
  droppable?: boolean;
  onSlotClick?: (colId: string, time?: string) => void;
  onResize?: OnItemResize;
}) {
  const templateCols = `3.5rem repeat(${columns.length}, minmax(8rem, 1fr))`;
  const hasBanner = columns.some(c => c.layout.allDay.length > 0 || c.layout.outOfRange.length > 0);
  const render = renderEvent;

  // Grille 24h = haute (48 creneaux). Au montage, on defile vers l'heure ouvree
  // (AGENDA_SCROLL_TO_HOUR) pour ne pas ouvrir sur minuit. Une seule fois : la
  // navigation (semaine/jour suivant) ne re-scrolle pas, l'utilisateur garde sa
  // position. Un meme axe de scroll (x + y) synchronise en-tete, bandeau et corps.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const slotsFromStart = Math.max(0, ((AGENDA_SCROLL_TO_HOUR - AGENDA_HOUR_START) * 60) / AGENDA_SLOT_MIN);
    el.scrollTop = slotsFromStart * SLOT_PX;
  }, []);

  return (
    <div className="card p-0">
      <div ref={scrollRef} className="overflow-auto max-h-[70vh]">
      <div className="min-w-max">
        {/* En-tetes de colonnes (gouttiere vide + colonnes) */}
        <div className="grid sticky top-0 bg-white z-10 border-b border-gray-200" style={{ gridTemplateColumns: templateCols }}>
          <div className="border-r border-gray-100" />
          {columns.map(c => (
            <div key={c.id} className="px-2 py-2 border-r border-gray-100 last:border-r-0">{c.header}</div>
          ))}
        </div>

        {/* Bandeau "toute la journee" + hors-plage (jamais perdues), cliquable
            pour creer une action all-day (time undefined). */}
        {hasBanner && (
          <div className="grid bg-gray-50/60 border-b border-gray-200" style={{ gridTemplateColumns: templateCols }}>
            <div className="px-1 py-1 text-[10px] text-gray-400 text-right pr-2 border-r border-gray-100 self-center">toute la j.</div>
            {columns.map(c => (
              <div
                key={c.id}
                onClick={onSlotClick ? () => onSlotClick(c.id, undefined) : undefined}
                className={cn('p-1 space-y-1 border-r border-gray-100 last:border-r-0', onSlotClick && 'cursor-pointer hover:bg-primary-50/30')}
              >
                {c.layout.allDay.map(e => <div key={e.id}>{render(e)}</div>)}
                {c.layout.outOfRange.map(e => <div key={e.id}>{render(e)}</div>)}
                {c.layout.allDay.length === 0 && c.layout.outOfRange.length === 0 && <span className="block text-[10px] text-gray-300">+</span>}
              </div>
            ))}
          </div>
        )}

        {/* Corps : gouttiere d'heures + colonnes (blocs en absolu) */}
        <div className="grid" style={{ gridTemplateColumns: templateCols }}>
          <div className="relative">
            {slots.map(slot => (
              <div key={slot} style={{ height: SLOT_PX }} className="px-1 text-[10px] text-gray-400 text-right pr-2 border-r border-t border-gray-100">
                {slot.endsWith(':00') ? slot : ''}
              </div>
            ))}
          </div>
          {columns.map(c => (
            <ColumnBody key={c.id} col={c} slots={slots} droppable={droppable} onSlotClick={onSlotClick} render={render} onResize={onResize} />
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}

// --- Vue JOURNEE COMPARATIVE en GRILLE HORAIRE : heures x commerciaux ---
// (vue "reunion du lundi" + creneaux). Toutes les colonnes affichees meme vides.
// Un evenement dont le commercial n'est PAS dans les colonnes (desactive mais
// lead encore assigne, hors filtre) tombe dans "Autres" -> aucune action masquee.
// Drag = change l'HEURE (la date reste le jour affiche ; le commercial ne change
// jamais) ; le re-selecteur de DATE reste sur le bloc pour changer le jour.
function DayView({ anchor, setAnchor, byDay, columns, onOpen, onEditEvent, onCreate, onReplan, onItemMove, onItemResize }: {
  anchor: Date;
  setAnchor: (d: Date) => void;
  byDay: Map<string, GridItem[]>;
  columns: Commercial[];
  onOpen: (leadId: string) => void;
  onEditEvent: (event: CalendarEvent) => void;
  onCreate: OnCreate;
  onReplan: OnReplan;
  onItemMove: OnItemMove;
  onItemResize: OnItemResize;
}) {
  const { state } = useApp();
  const dayISO = toISODate(anchor);
  const events = byDay.get(dayISO) ?? [];
  const isToday = isSameDay(anchor, new Date());
  const slots = buildTimeSlots();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );
  // En Journee, toutes les colonnes partagent la date affichee (anchor) : le drag
  // ne change que l'HEURE (delta.y), jamais le jour ni le commercial.
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over, delta } = e;
    if (!over) return;
    const item = active.data.current?.item as GridItem | undefined;
    if (!item) return;
    onItemMove(item, dayISO, delta.y);
  };

  const colIds = new Set(columns.map(c => c.id));
  const orphans = events.filter(e => !colIds.has(itemCommercialId(e) ?? ''));

  const gridColumns: GridColumn[] = columns.map(c => {
    const colEvents = events.filter(e => itemCommercialId(e) === c.id);
    const color = getCommercialColor(c.id, state.commercials);
    return {
      id: c.id,
      header: <ColumnHeader dot={color.dot} title={c.name} count={colEvents.length} />,
      layout: layoutDayGrid(colEvents),
    };
  });
  if (orphans.length > 0) {
    gridColumns.push({
      id: '__autres',
      header: <ColumnHeader dot="bg-gray-400" title="Autres" count={orphans.length} />,
      layout: layoutDayGrid(orphans),
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
      {/* En Journee, les colonnes sont des COMMERCIAUX : creation et drag visent
          toujours le jour affiche (anchor), pas le colId. Le drag change l'heure ;
          le bouton re-selecteur (onReplan) change la date. */}
      <DndContext sensors={sensors} collisionDetection={dayCollision} onDragEnd={handleDragEnd}>
        <TimeGrid
          slots={slots}
          columns={gridColumns}
          droppable
          renderEvent={item => <DraggableGridItem item={item} onOpen={onOpen} onEditEvent={onEditEvent} onReplan={onReplan} compact />}
          onSlotClick={(_colId, time) => onCreate(dayISO, time)}
          onResize={onItemResize}
        />
      </DndContext>
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

// --- Modale evenement libre : creation OU edition (+ suppression) ---
function CalendarEventModal({ existing, initialDate, initialTime, commercials, onSave, onDelete, onClose }: {
  existing: CalendarEvent | null;
  initialDate: string;
  initialTime?: string;
  commercials: Commercial[];
  onSave: (data: Omit<CalendarEvent, 'id'>) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [date, setDate] = useState(existing?.date ?? initialDate);
  const [time, setTime] = useState(existing?.time ?? initialTime ?? '');
  const [endTime, setEndTime] = useState(existing?.endTime ?? '');
  const [commercialId, setCommercialId] = useState(existing?.commercialId ?? '');
  const [category, setCategory] = useState<CalendarEventCategory>(existing?.category ?? 'autre');
  const [note, setNote] = useState(existing?.note ?? '');

  const endTimeInvalid = !!endTime && !isEndAfterStart(time, endTime);
  const canSave = !!title.trim() && !!date && !endTimeInvalid;
  // Verrou anti-double-soumission (correctif #2) : pas de double événement créé.
  const { locked, guard } = useSubmitLock();

  const submit = () => {
    if (!canSave) return;
    guard(() => onSave({
      title: title.trim(),
      date,
      time: time || undefined,
      endTime: time && endTime && isEndAfterStart(time, endTime) ? endTime : undefined,
      commercialId: commercialId || undefined,
      category,
      note: note.trim() || undefined,
    }));
  };

  return (
    <Modal open onClose={onClose} title={existing ? "Modifier l'événement" : 'Nouvel événement'} size="sm">
      <div className="space-y-4">
        <div>
          <label className="label">Titre *</label>
          <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Réunion, congé, déplacement…" autoFocus />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Heure</label>
            <input className="input" type="time" value={time} onChange={e => { setTime(e.target.value); if (!e.target.value) setEndTime(''); }} />
          </div>
          <div>
            <label className="label">Fin</label>
            <input className="input" type="time" value={endTime} disabled={!time} onChange={e => setEndTime(e.target.value)} />
          </div>
        </div>
        {endTimeInvalid && <p className="text-xs text-danger-600">L'heure de fin doit être postérieure à l'heure de début.</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Commercial</label>
            <select className="select" value={commercialId} onChange={e => setCommercialId(e.target.value)}>
              <option value="">Général (équipe)</option>
              {commercials.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Catégorie</label>
            <select className="select" value={category} onChange={e => setCategory(e.target.value as CalendarEventCategory)}>
              {CALENDAR_EVENT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Note</label>
          <textarea className="input min-h-[70px]" value={note} onChange={e => setNote(e.target.value)} />
        </div>
        <div className="flex items-center gap-2 pt-1">
          {onDelete && (
            <button onClick={onDelete} className="btn-ghost btn-sm text-danger-600 hover:bg-danger-50 mr-auto">
              <Trash2 className="w-4 h-4" /> Supprimer
            </button>
          )}
          <button onClick={onClose} className="btn-secondary btn-sm ml-auto">Annuler</button>
          <button onClick={submit} disabled={!canSave || locked} className="btn-primary btn-sm disabled:opacity-50">
            {existing ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// --- Createur : lead ELIGIBLE (sans action) + type + heure (pre-remplie depuis
// le creneau clique, modifiable ; vide = action toute la journee) ---
function CreateActionModal({ dateISO, initialTime, leads, onClose, onCreate }: {
  dateISO: string;
  initialTime?: string;
  leads: Lead[];
  onClose: () => void;
  onCreate: (leadId: string, type: ActionType, timeHHmm?: string, endTimeHHmm?: string) => void;
}) {
  const { getCommercialName } = useApp();
  const eligible = useMemo(() => getCreatableLeads(leads), [leads]);
  const [leadId, setLeadId] = useState('');
  const [type, setType] = useState<ActionType>('appel');
  const [time, setTime] = useState(initialTime ?? '');
  const [endTime, setEndTime] = useState('');
  const endTimeInvalid = !!endTime && !isEndAfterStart(time, endTime);

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
          <div>
            <label className="label">Type d'action</label>
            <select className="select" value={type} onChange={e => setType(e.target.value as ActionType)}>
              {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Heure (facultative)</label>
              <input className="input" type="time" value={time} onChange={e => { setTime(e.target.value); if (!e.target.value) setEndTime(''); }} />
            </div>
            <div>
              <label className="label">Fin (facultative)</label>
              <input className="input" type="time" value={endTime} disabled={!time} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>
          {endTimeInvalid && (
            <p className="text-xs text-danger-600">L'heure de fin doit être postérieure à l'heure de début.</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="btn-secondary btn-sm">Annuler</button>
            <button onClick={() => onCreate(leadId, type, time || undefined, endTime || undefined)} disabled={!leadId || endTimeInvalid} className="btn-primary btn-sm disabled:opacity-50">Planifier</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
