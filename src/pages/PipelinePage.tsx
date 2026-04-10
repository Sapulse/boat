import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApp } from '../context/AppContext';
import { StatusBadge, TemperatureBadge, AlertDot } from '../components/ui/StatusBadge';
import { formatCurrency, getAlertLevel, getLeadFullName, daysSince, cn } from '../lib/utils';
import { PIPELINE_STATUSES } from '../data/constants';
import type { Lead, LeadStatus } from '../data/types';

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

function SortableCard({ lead }: { lead: Lead }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    data: { type: 'lead', lead },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onDoubleClick={() => navigate(`/leads/${lead.id}`)}
    >
      <LeadCard lead={lead} />
    </div>
  );
}

function Column({ status, leads }: { status: LeadStatus; leads: Lead[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { type: 'column', status } });
  const total = leads.reduce((sum, l) => sum + (l.budget ?? 0), 0);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col bg-gray-100/80 rounded-xl min-w-[260px] w-[280px] shrink-0 transition-colors',
        isOver && 'bg-primary-50 ring-2 ring-primary-300/50'
      )}
    >
      <div className="px-3 py-3 border-b border-gray-200/60">
        <div className="flex items-center justify-between mb-1">
          <StatusBadge status={status} />
          <span className="text-xs font-medium text-gray-500 bg-white px-2 py-0.5 rounded-full">
            {leads.length}
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-1">{formatCurrency(total)}</p>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-240px)]">
        {leads.map(lead => (
          <SortableCard key={lead.id} lead={lead} />
        ))}
        {leads.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-8">
            Aucun lead
          </div>
        )}
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const { state, updateLeadStatus } = useApp();
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const leadsByStatus = PIPELINE_STATUSES.reduce((acc, status) => {
    acc[status] = state.leads.filter(l => l.status === status);
    return acc;
  }, {} as Record<LeadStatus, Lead[]>);

  const handleDragStart = (event: DragStartEvent) => {
    const lead = state.leads.find(l => l.id === event.active.id);
    if (lead) setActiveLead(lead);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveLead(null);
    const { active, over } = event;
    if (!over) return;

    const leadId = active.id as string;
    let newStatus: LeadStatus | undefined;

    if (over.data?.current?.type === 'column') {
      newStatus = over.data.current.status as LeadStatus;
    } else {
      const overLead = state.leads.find(l => l.id === over.id);
      if (overLead) newStatus = overLead.status;
    }

    if (newStatus) {
      const currentLead = state.leads.find(l => l.id === leadId);
      if (currentLead && currentLead.status !== newStatus) {
        updateLeadStatus(leadId, newStatus);
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 lg:-mx-6 lg:px-6">
        {PIPELINE_STATUSES.map(status => (
          <Column key={status} status={status} leads={leadsByStatus[status]} />
        ))}
      </div>
      <DragOverlay>
        {activeLead && <LeadCard lead={activeLead} overlay />}
      </DragOverlay>
    </DndContext>
  );
}
