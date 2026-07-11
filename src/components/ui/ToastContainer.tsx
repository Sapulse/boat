import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import type { Toast, ToastKind } from '../../context/toastReducer';

// Rendu pur de la pile de toasts (l'état et les timers vivent dans ToastProvider).
// aria-live="polite" : les lecteurs d'écran annoncent chaque toast sans couper
// la lecture en cours. print:hidden : jamais sur les exports imprimés.

const KIND_ICON: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const KIND_COLOR: Record<ToastKind, string> = {
  success: 'text-success-600',
  error: 'text-danger-600',
  info: 'text-primary-600',
};

export default function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 print:hidden">
      {toasts.map(toast => {
        const Icon = KIND_ICON[toast.kind];
        return (
          <div
            key={toast.id}
            role="status"
            className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 text-sm text-gray-900 max-w-xs"
          >
            <Icon className={`w-4 h-4 shrink-0 ${KIND_COLOR[toast.kind]}`} />
            <span className="flex-1">{toast.message}</span>
            <button onClick={() => onDismiss(toast.id)} className="p-0.5 text-gray-400 hover:text-gray-600 rounded" title="Fermer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
