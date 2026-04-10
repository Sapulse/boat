import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../context/AppContext';
import LeadForm from '../components/leads/LeadForm';
import type { Lead } from '../data/types';

export default function NewLeadPage() {
  const navigate = useNavigate();
  const { addLead } = useApp();

  const handleSave = (data: Omit<Lead, 'id'>) => {
    const id = addLead(data);
    navigate(`/leads/${id}`);
  };

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => navigate('/leads')} className="btn-ghost btn-sm mb-4">
        <ArrowLeft className="w-4 h-4" /> Retour
      </button>
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Nouveau lead</h2>
        <LeadForm onSave={handleSave} onCancel={() => navigate('/leads')} />
      </div>
    </div>
  );
}
