import type { InboundEmail } from './types';

// DONNÉES FICTIVES — maquette de l'écran « Boîte de réception prospects »
// (Étape A). Huit emails inventés, calqués sur les 4 familles réelles de la
// spec (Import_emails_prospects_SPEC.md §1-§3) : un boats.com riche, un
// formulaire du site, les deux formats Leboncoin, un Band of Boats mince et
// deux parasites. Aucune personne réelle ; domaines en .example quand possible.
//
// Cas DOUBLON voulu pour la démo : 'in-site-relance' reprend l'email et le
// téléphone de 'in-boats-antares' (même prospect qui relance par le site).
// Accepter la carte boats.com fait apparaître le bandeau doublon sur l'autre.
export const MOCK_INBOUND_EMAILS: InboundEmail[] = [
  {
    id: 'in-boats-antares',
    receivedAt: '2026-07-28 08:42',
    fromAddress: 'lead@leads.boats.com',
    subject: 'INTERESTED-IN: Antares 8 OB (2019) — YachtWorld',
    excerpt:
      'PROSPECT INDIVIDUEL — Marc Le Goff · +33 6 12 34 56 78 · marc.legoff@exemple.fr\n' +
      '« Bonjour, je suis intéressé par votre Antarès 8 OB de 2019. Est-il toujours disponible ? ' +
      'Serait-il possible d’organiser une visite à Brest ? »\n' +
      'LEADSMART : a aussi consulté un Antarès 9 OB, un Merry Fisher 795 et un Cap Camarat 7.5 ces 7 derniers jours.',
    sourceLabel: 'boats.com / BoatWizard',
    sourceDetail: 'YachtWorld',
    leadSource: 'boats.com',
    score: 92,
    scoreReasons: [
      'Bateau précis (Antarès 8 OB, 2019)',
      'Format boats.com : 100 % fiable sur l’échantillon',
      'Téléphone + email fournis',
      'LeadSmart : acheteur actif (3 bateaux consultés)',
    ],
    extracted: {
      firstName: 'Marc',
      lastName: 'Le Goff',
      email: 'marc.legoff@exemple.fr',
      phone: '+33 6 12 34 56 78',
      boatInterest: 'Antarès 8 OB (2019)',
      brand: 'Bénéteau',
    },
    status: 'a_traiter',
  },
  {
    id: 'in-lbc-camarat',
    receivedAt: '2026-07-27 18:20',
    fromAddress: 'reponse@messagerie.leboncoin.fr',
    subject: 'Cap Camarat 6.5 WA — Réponse à votre annonce',
    excerpt:
      '« Bonjour, votre Cap Camarat 6.5 WA m’intéresse. Accepteriez-vous une reprise de mon ' +
      'Quicksilver 555 en l’état ? Je suis de Brest, disponible en semaine. » — Paul Riou, Brest.',
    sourceLabel: 'Leboncoin',
    sourceDetail: 'format récent (étiqueté)',
    leadSource: 'LBC',
    score: 84,
    scoreReasons: [
      'Bateau précis (Cap Camarat 6.5 WA) + reprise proposée',
      'Format récent : coordonnées étiquetées complètes',
      'Mobile FR personnel fourni',
    ],
    extracted: {
      firstName: 'Paul',
      lastName: 'Riou',
      email: 'paul.riou@exemple.fr',
      phone: '07 11 22 33 44',
      boatInterest: 'Cap Camarat 6.5 WA — reprise Quicksilver 555',
      brand: 'Jeanneau',
    },
    status: 'a_traiter',
  },
  {
    id: 'in-site-relance',
    receivedAt: '2026-07-28 11:05',
    fromAddress: 'noreply@brest-ocean-boat.fr',
    subject: 'Nouveau message depuis le site — Formulaire de contact',
    excerpt:
      '« Bonjour, je vous ai contactés hier via YachtWorld au sujet de l’Antarès 8 OB, sans réponse ' +
      'pour l’instant. Je suis disponible ce week-end pour une visite au port. Cordialement, Marc Le Goff. »',
    sourceLabel: 'Formulaire du site',
    leadSource: 'Site BOB',
    score: 80,
    scoreReasons: [
      'Bateau précis (Antarès 8 OB)',
      'Intention claire : demande de visite',
      'Coordonnées personnelles complètes',
    ],
    extracted: {
      firstName: 'Marc',
      lastName: 'Le Goff',
      email: 'marc.legoff@exemple.fr',
      phone: '06 12 34 56 78',
      boatInterest: 'Antarès 8 OB (2019)',
      brand: 'Bénéteau',
    },
    status: 'a_traiter',
  },
  {
    id: 'in-site-entretien',
    receivedAt: '2026-07-27 09:51',
    fromAddress: 'noreply@brest-ocean-boat.fr',
    subject: 'Nouveau message depuis le site — Demande de devis',
    excerpt:
      '« Bonjour, je souhaiterais un devis pour l’entretien annuel de mon Merry Fisher 695 ' +
      '(moteur Yamaha F130). Le bateau est au Moulin Blanc. Quelles seraient vos disponibilités en août ? »',
    sourceLabel: 'Formulaire du site',
    leadSource: 'Site BOB',
    score: 76,
    scoreReasons: [
      'Intention claire : devis entretien',
      'Bateau précis (Merry Fisher 695)',
      'Champs du formulaire complets (tél + email + ville)',
    ],
    extracted: {
      firstName: 'Élodie',
      lastName: 'Kervella',
      email: 'e.kervella@exemple.fr',
      phone: '06 98 76 54 32',
      boatInterest: 'Merry Fisher 695 — entretien annuel',
      brand: 'Jeanneau',
    },
    status: 'a_traiter',
  },
  {
    id: 'in-lbc-highfield',
    receivedAt: '2026-07-26 21:37',
    fromAddress: 'breizhnav29@messagerie.leboncoin.fr',
    subject: 'Highfield 700 — Réponse à votre annonce',
    excerpt:
      '[fil de conversation Leboncoin — dernier message] « Bonjour, le bateau est-il toujours ' +
      'disponible ? Serait-il visible ce week-end ? » — pseudo : breizhnav29, pas de téléphone communiqué.',
    sourceLabel: 'Leboncoin',
    sourceDetail: 'format ancien (pauvre)',
    leadSource: 'LBC',
    score: 58,
    scoreReasons: [
      'Intérêt réel pour une annonce (objet)',
      'Format ancien : email + pseudo seulement',
      'Pas de téléphone, nom à compléter',
    ],
    extracted: {
      firstName: '',
      lastName: 'breizhnav29',
      email: 'breizhnav29@exemple.fr',
      phone: '',
      boatInterest: 'Highfield 700',
      brand: 'Highfield',
    },
    status: 'a_traiter',
  },
  {
    id: 'in-bob-antares9',
    receivedAt: '2026-07-27 14:12',
    fromAddress: 'info@bandofboats.com',
    subject: 'Nouveau message pour votre annonce Antarès 9 OB',
    excerpt:
      'Christophe vous a envoyé un message au sujet de votre annonce Antarès 9 OB : « Bonjour, ' +
      'quel est le nombre d’heures moteur ? Révisions à jour ? » — Répondre via la plateforme Band of Boats.',
    sourceLabel: 'Band of Boats',
    leadSource: 'Band of Boats',
    score: 52,
    scoreReasons: [
      'Bateau identifié (objet de l’annonce)',
      'Ni email ni téléphone direct : réponse via la plateforme',
      'Source qui mélange prospects et administratif',
    ],
    extracted: {
      firstName: 'Christophe',
      lastName: '',
      email: '',
      phone: '',
      boatInterest: 'Antarès 9 OB',
      brand: 'Bénéteau',
    },
    status: 'a_traiter',
  },
  {
    id: 'in-para-webdev',
    receivedAt: '2026-07-27 08:03',
    fromAddress: 'contact@agenceweb-horizon.example',
    subject: 'Refonte de votre site internet — proposition',
    excerpt:
      '« Bonjour, je suis développeur web freelance. En visitant votre site, j’ai remarqué plusieurs ' +
      'points qui pourraient être modernisés (vitesse, référencement). Seriez-vous ouvert à un échange ' +
      'téléphonique cette semaine ? »',
    sourceLabel: 'Formulaire du site',
    leadSource: 'Site BOB',
    score: 12,
    scoreReasons: [
      'Parle de SON offre, pas d’un bateau',
      'Émetteur : entreprise tierce (agence web)',
      'Aucun bateau ni projet nautique mentionné',
    ],
    extracted: {
      firstName: 'Yann',
      lastName: 'Bernard',
      email: 'contact@agenceweb-horizon.example',
      phone: '',
      boatInterest: '',
      brand: '',
    },
    status: 'a_traiter',
  },
  {
    id: 'in-para-hotel',
    receivedAt: '2026-07-26 16:45',
    fromAddress: 'partenariats@sejours-iroise.example',
    subject: 'Partenariat hébergement pour vos clients plaisanciers',
    excerpt:
      '« Bonjour, notre groupe hôtelier propose des séjours en mer d’Iroise. Nous serions ravis ' +
      'd’étudier un partenariat / une collaboration avec votre concession pour héberger vos clients. »',
    sourceLabel: 'Formulaire du site',
    leadSource: 'Site BOB',
    score: 8,
    scoreReasons: [
      'Démarchage B2B (« partenariat / collaboration »)',
      'Émetteur : entreprise tierce (groupe hôtelier)',
      'Aucun bateau mentionné',
    ],
    extracted: {
      firstName: '',
      lastName: '',
      email: 'partenariats@sejours-iroise.example',
      phone: '',
      boatInterest: '',
      brand: '',
    },
    status: 'a_traiter',
  },
];
