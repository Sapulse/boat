import type { InboundExtracted } from '../../data/types.js';

// Types du module d'extraction email (chantier import prospects, « cerveau »).
// parseEmail est PUR : il reçoit un email déjà décodé (en prod : Microsoft
// Graph fournit from/subject/body ; au harnais : les .eml décodés côté script)
// et ne fait AUCUNE I/O. Le MIME/RFC2047 n'entre jamais ici.

/** Email décodé en entrée : `text` prioritaire, repli `html` (Band of Boats). */
export interface RawInboundEmail {
  from: string;      // en-tête From ("Nom <adresse>" ou adresse seule)
  subject: string;
  text?: string;     // corps texte brut
  html?: string;     // corps HTML (converti via htmlToText si text absent)
}

/** Familles de sources (spec §1) + repli inconnu. */
export type EmailSourceKind = 'boatscom' | 'site' | 'leboncoin' | 'bandofboats' | 'inconnu';

export interface ParsedEmail {
  source: EmailSourceKind;
  /** Libellé d'affichage de la famille (aligné sur la maquette InboundEmail). */
  sourceLabel: string;
  /** Précision : plateforme réelle (Origine du contact boats.com) ou format LBC. */
  sourceDetail?: string;
  /** Valeur pour Lead.source — appartient à SOURCES, ou '' si source inconnue. */
  leadSource: string;
  extracted: InboundExtracted;
  /** Message pertinent du prospect (débarrassé du tracking / des transferts). */
  excerpt: string;
  /** Contexte à verser aux commentaires du lead : LeadSmart, Ref Infocob,
   *  adresse, consentement RGPD, fil Leboncoin, prix de l'annonce… */
  notes: string[];
  /** Score de pertinence 0..98 (spec §3) — trie la file, ne décide pas. */
  score: number;
  scoreReasons: string[];
}

/** Résultat intermédiaire d'un extracteur de famille, avant scoring. */
export interface ExtractResult {
  extracted: InboundExtracted;
  sourceDetail?: string;
  excerpt: string;
  notes: string[];
  flags: {
    /** Facture / cotation Band of Boats : administratif, pas un prospect. */
    isAdmin?: boolean;
    /** Notification automatique (annonce téléchargée en PDF) : pas un message réel. */
    isAutoNotification?: boolean;
    /** Bloc LeadSmart non vide : acheteur actif (boats.com). */
    hasLeadSmart?: boolean;
    /** Format Leboncoin récent : coordonnées étiquetées complètes. */
    richFormat?: boolean;
  };
}
