import { useEffect } from 'react';
import { Printer } from 'lucide-react';

/**
 * Bouton "Exporter en PDF" : declenche window.print() (l'utilisateur choisit
 * "Enregistrer en PDF" dans la boite d'impression). Le bouton lui-meme porte la
 * classe no-print pour ne pas apparaitre dans le rapport.
 *
 * Parade Recharts : ResponsiveContainer dimensionne les graphes selon la largeur
 * ECRAN via un ResizeObserver asynchrone. A l'impression la largeur change
 * (sidebar masquee, page A4 paysage) et le re-rendu peut arriver apres le snapshot
 * -> graphe deborde / blanc. On ecoute donc beforeprint et on y declenche un
 * evenement resize, ce qui force ResponsiveContainer a se re-mesurer a la largeur
 * d'impression AVANT le rendu du PDF.
 */
export default function PrintButton({ label = 'Exporter en PDF' }: { label?: string }) {
  useEffect(() => {
    const handleBeforePrint = () => window.dispatchEvent(new Event('resize'));
    window.addEventListener('beforeprint', handleBeforePrint);
    return () => window.removeEventListener('beforeprint', handleBeforePrint);
  }, []);

  return (
    <button onClick={() => window.print()} className="btn-secondary btn-sm no-print">
      <Printer className="w-4 h-4" />
      {label}
    </button>
  );
}
