import type { Lead, LeadAction, MonthlyStat, AcquisitionVolume } from './types';
import { DEFAULT_COMMERCIALS, SOURCES, MONTHLY_STAT_SOURCES, ACQUISITION_SOURCES } from './constants';
import { generateId, toISODate } from '../lib/utils';
import { subDays, subMonths } from 'date-fns';

const now = new Date();

function randomDate(minDaysAgo: number, maxDaysAgo: number): string {
  const days = Math.floor(Math.random() * (maxDaysAgo - minDaysAgo)) + minDaysAgo;
  return toISODate(subDays(now, days));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const boatNames = [
  'Beneteau Oceanis 38.1', 'Jeanneau Sun Odyssey 440', 'Lagoon 42',
  'Beneteau Antares 9', 'Quicksilver Activ 755', 'Zodiac Medline 7.5',
  'Beneteau Gran Turismo 36', 'Jeanneau Cap Camarat 7.5', 'Boston Whaler 280',
  'Prestige 520', 'Beneteau Flyer 9', 'Yamaha FX Cruiser',
  'Jeanneau Merry Fisher 895', 'Zodiac N-ZO 760', 'Beneteau Swift Trawler 41',
];

const firstNames = ['Jean', 'Pierre', 'Marie', 'Sophie', 'Laurent', 'Philippe', 'Nathalie', 'François', 'Isabelle', 'Patrick', 'Catherine', 'Michel', 'Christophe', 'Anne', 'Olivier', 'Eric', 'Sylvie', 'Bruno', 'Véronique', 'Didier', 'Alain', 'Brigitte', 'Thierry', 'Martine', 'Gilles'];
const lastNames = ['Martin', 'Dupont', 'Bernard', 'Robert', 'Richard', 'Moreau', 'Leroy', 'Simon', 'Laurent', 'Michel', 'Lefebvre', 'Garcia', 'Thomas', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'Andre', 'Mercier', 'Blanc', 'Guerin', 'Boyer'];

const statuses = ['nouveau', 'a_contacter', 'contacte', 'qualifie', 'devis_envoye', 'negociation', 'en_conclusion', 'signe', 'perdu', 'reporte'] as const;
const temperatures = ['froid', 'tiede', 'chaud'] as const;
const boatTypes = ['Moteur', 'Voile', 'Semi-rigide'] as const;
const boatConditions = ['Neuf', 'BO', 'DV'] as const;

export function generateSeedLeads(count: number = 35): Lead[] {
  const leads: Lead[] = [];
  for (let i = 0; i < count; i++) {
    const status = pick([...statuses]);
    const temp = pick([...temperatures]);
    const createdAt = randomDate(5, 120);
    const isSigned = status === 'signe';
    const isLost = status === 'perdu';
    const isReported = status === 'reporte';
    const budget = Math.round((Math.random() * 200000 + 15000) / 1000) * 1000;
    const hasQuote = ['devis_envoye', 'negociation', 'en_conclusion', 'signe', 'perdu'].includes(status);

    leads.push({
      id: generateId(),
      createdAt,
      source: pick(SOURCES),
      commercialId: pick(DEFAULT_COMMERCIALS).id,
      firstName: pick(firstNames),
      lastName: pick(lastNames),
      phone: `06 ${String(Math.floor(Math.random() * 100)).padStart(2, '0')} ${String(Math.floor(Math.random() * 100)).padStart(2, '0')} ${String(Math.floor(Math.random() * 100)).padStart(2, '0')} ${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`,
      email: `${pick(firstNames).toLowerCase()}.${pick(lastNames).toLowerCase()}@email.fr`,
      boatType: pick([...boatTypes]),
      boatCondition: pick([...boatConditions]),
      boatInterest: pick(boatNames),
      brand: pick(['Beneteau', 'Jeanneau', 'Lagoon', 'Quicksilver', 'Zodiac', 'Prestige', 'Boston Whaler', 'Yamaha']),
      budget,
      status,
      contactDate: status === 'nouveau' ? '' : randomDate(3, 90),
      quoteAmount: hasQuote ? Math.round(budget * (0.85 + Math.random() * 0.3) / 1000) * 1000 : null,
      probability: hasQuote ? Math.round(Math.random() * 100 / 10) * 10 : null,
      currentBoat: Math.random() > 0.4 ? pick(boatNames) : '',
      comments: pick([
        'Client très intéressé, à rappeler rapidement',
        'Budget serré, proposer options de financement',
        'Souhaite essayer le bateau avant de se décider',
        'Premier achat, besoin d\'accompagnement',
        'Client fidèle, renouvellement de bateau',
        'Vient du salon, très motivé',
        'Demande un devis comparatif',
        'Attend la livraison du nouveau modèle',
        '',
      ]),
      deliveryDate: isSigned ? randomDate(-90, -10) : '',
      temperature: temp,
      nextActionType: ['signe', 'perdu'].includes(status) ? '' : pick(['appel', 'email', 'rdv', 'relance', 'devis'] as const),
      nextActionDate: ['signe', 'perdu'].includes(status) ? '' : randomDate(-5, 14),
      lastActionDate: randomDate(0, 30),
      lossReason: isLost ? pick(['Prix trop élevé', 'A trouvé ailleurs', 'Projet reporté', 'Ne répond plus', 'Budget insuffisant']) : '',
      signedAt: isSigned ? randomDate(0, 30) : '',
      lostAt: isLost ? randomDate(0, 30) : '',
      reportedAt: isReported ? randomDate(0, 30) : '',
    });
  }
  return leads;
}

export function generateSeedActions(leads: Lead[]): LeadAction[] {
  const actions: LeadAction[] = [];
  for (const lead of leads) {
    const numActions = Math.floor(Math.random() * 4) + 1;
    for (let i = 0; i < numActions; i++) {
      actions.push({
        id: generateId(),
        leadId: lead.id,
        type: pick(['appel', 'email', 'rdv', 'relance', 'note'] as const),
        date: randomDate(0, 60),
        result: pick(['Intéressé', 'À rappeler', 'Pas disponible', 'Demande envoyée', 'Devis transmis', 'En réflexion']),
        notes: pick(['Conversation positive', 'Message laissé', 'RDV planifié', 'Documents envoyés', '']),
        authorId: lead.commercialId,
      });
    }
  }
  return actions;
}

export function generateSeedMonthlyStats(): MonthlyStat[] {
  const stats: MonthlyStat[] = [];
  const year = now.getFullYear();
  for (let month = 1; month <= 3; month++) {
    for (const source of MONTHLY_STAT_SOURCES) {
      const budget = Math.round((Math.random() * 3000 + 500) / 100) * 100;
      const leads = Math.floor(Math.random() * 25) + 2;
      stats.push({
        id: generateId(),
        year,
        month,
        source,
        budget,
        leads,
        cpl: leads > 0 ? Math.round(budget / leads) : null,
      });
    }
  }
  return stats;
}

export function generateSeedAcquisitionVolumes(): AcquisitionVolume[] {
  const volumes: AcquisitionVolume[] = [];
  for (let i = 4; i >= 0; i--) {
    const d = subMonths(now, i);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    for (const source of ACQUISITION_SOURCES) {
      volumes.push({
        id: generateId(),
        source,
        month,
        year,
        leadCount: Math.floor(Math.random() * 30) + 1,
      });
    }
  }
  return volumes;
}
