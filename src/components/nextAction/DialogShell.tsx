import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Cadre des fenêtres du lot 2 (prochaine action, confirmation d'envoi, note d'appel).
 *
 * Différences avec ui/Modal, voulues :
 *  - `closable={false}` : ni croix, ni Échap, ni clic à côté. On ne sort que par
 *    les boutons du pied (décision : la prochaine action n'est pas facultative) ;
 *  - plein écran sous 640 px, pied FIXE en bas (boutons toujours atteignables au
 *    pouce, même quand le clavier virtuel réduit la hauteur) ;
 *  - au-dessus de toute autre modale (z-[60]).
 * Focus : premier champ à l'ouverture, Tab reste dans la fenêtre.
 */
export default function DialogShell({
  title, subtitle, closable, onClose, children, footer, size = 'md',
}: {
  title: string;
  subtitle?: ReactNode;
  closable: boolean;
  onClose?: () => void;
  children: ReactNode;
  footer: ReactNode;
  size?: 'sm' | 'md';
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const first = focusables(panelRef.current).find(el => el.tagName !== 'BUTTON') ?? focusables(panelRef.current)[0];
    first?.focus();
    return () => { previouslyFocused?.focus?.(); };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Non fermable : Échap est ABSORBÉ (ni cette fenêtre ni une modale dessous ne se ferment).
        e.preventDefault();
        e.stopPropagation();
        if (closable) onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(panelRef.current);
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      const inside = panelRef.current?.contains(active) ?? false;
      if (e.shiftKey && (active === firstEl || !inside)) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && (active === lastEl || !inside)) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [closable, onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex sm:items-start sm:justify-center sm:pt-10 sm:px-4">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => { if (closable) onClose?.(); }}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative bg-white w-full h-full flex flex-col sm:h-auto sm:max-h-[88vh] sm:rounded-xl shadow-xl',
          size === 'sm' ? 'sm:max-w-md' : 'sm:max-w-xl',
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            {subtitle && <div className="text-sm text-gray-500 mt-0.5">{subtitle}</div>}
          </div>
          {closable && (
            <button onClick={onClose} aria-label="Fermer" className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 shrink-0">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="shrink-0 border-t border-gray-200 bg-white px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-xl">
          {footer}
        </div>
      </div>
    </div>
  );
}

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  ).filter(el => el.offsetParent !== null);
}
