import { SOURCES, isSourceSalon } from '../../data/constants';

interface Props {
  /**
   * Valeur courante. Si elle n'appartient pas à la liste de référence (ancien
   * libellé, import, saisie libre), elle est ajoutée en tête pour ne JAMAIS
   * disparaître du menu — sinon le simple fait d'ouvrir un formulaire
   * réécrirait la source du lead en silence.
   */
  valeur?: string;
}

/**
 * LOT SALONS (S0) — options d'un sélecteur de source, SALONS EN TÊTE.
 *
 * Les salons sont regroupés dans un `<optgroup>` placé en premier : pendant les
 * cinq jours d'un salon, c'est la source que l'équipe choisit vingt fois par
 * jour, et elle ne doit pas être à chercher au milieu de vingt lignes.
 *
 * Le regroupement se déduit du PRÉFIXE « Salon – » : ajouter un salon l'an
 * prochain ne demande que d'ajouter sa valeur dans SOURCES, rien ici.
 *
 * Aucun millésime dans les libellés : la source dit d'où vient le lead,
 * l'édition du salon appartient à la campagne (voir data/constants).
 *
 * Composant partagé par les sept sélecteurs de source de l'app — une seule
 * définition de l'ordre et des groupes.
 */
export default function OptionsSource({ valeur }: Props) {
  const salons = (SOURCES as readonly string[]).filter(isSourceSalon);
  const autres = (SOURCES as readonly string[]).filter(s => !isSourceSalon(s));
  const horsListe = valeur && !(SOURCES as readonly string[]).includes(valeur) ? valeur : null;

  return (
    <>
      {horsListe && <option value={horsListe}>{horsListe}</option>}
      <optgroup label="Salon">
        {salons.map(s => <option key={s} value={s}>{s}</option>)}
      </optgroup>
      <optgroup label="Autres sources">
        {autres.map(s => <option key={s} value={s}>{s}</option>)}
      </optgroup>
    </>
  );
}
