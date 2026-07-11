import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../context/useApp';
import { useToast } from '../context/useToast';
import LeadForm from '../components/leads/LeadForm';
import type { Lead } from '../data/types';
import { cn } from '../lib/utils';

export default function NewLeadPage() {
  const navigate = useNavigate();
  const { addLead } = useApp();
  const toast = useToast();
  const [isQuickMode, setIsQuickMode] = useState(true);

  const handleSave = (data: Omit<Lead, 'id'>) => {
    const id = addLead(data);
    toast.success('Lead créé');
    navigate(`/leads/${id}`);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => navigate('/leads')} className="btn-ghost btn-sm mb-4">
        <ArrowLeft className="w-4 h-4" /> Retour
      </button>
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Nouveau lead</h2>
        <div className="flex bg-gray-100 rounded-lg p-0.5 mb-4">
          <button
            type="button"
            onClick={() => setIsQuickMode(true)}
            className={cn(
              'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors',
              isQuickMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            Mode rapide
          </button>
          <button
            type="button"
            onClick={() => setIsQuickMode(false)}
            className={cn(
              'flex-1 py-1.5 text-sm font-medium rounded-md transition-colors',
              !isQuickMode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            )}
          >
            Mode complet
          </button>
        </div>
        <LeadForm onSave={handleSave} onCancel={() => navigate('/leads')} quickMode={isQuickMode} />
      </div>
    </div>
  );
}
