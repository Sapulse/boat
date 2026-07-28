import type { EmailSourceKind, ExtractResult } from './types.js';

// Score de pertinence prospect/parasite (spec §3), calibré sur les 23 emails
// réels de l'échantillon. Le score TRIE la file et SIGNALE — il ne décide
// jamais : la décision reste humaine (écran de validation). Seuils d'affichage
// existants (lib/inbound.ts) : >= 70 prospect probable, >= 40 à vérifier.

// Signaux d'INTENTION nautique (spec : « intention claire : acheter, vendre,
// entretenir, stocker, devis »). FR + EN (prospects étrangers réels : Slovénie,
// Allemagne, Croatie dans l'échantillon).
const INTENT = /(disponible|available|devis|entretien|maintenance|r[eé]vision|car[ée]nage|antifouling|hivernage|stockage|emplacement|place de port|reprise|acheter|achat|vendre|purchas\w*|int[eé]ress\w*|interest\w*|recherch\w*|visite|viewing|essai|heures? moteur|photos?|vitesse)/i;

// Signaux de PARASITE : « parle de SON offre, pas de TON bateau ». Chaque
// regex compte au plus une fois ; dès 1 hit la pénalité est forte, chaque hit
// supplémentaire l'aggrave (les parasites réels cumulent 3-5 signaux).
const PROMO: RegExp[] = [
  /d[eé]veloppeur|developer/i,
  /refonte/i,
  /sites? internet|site web/i,
  /r[eé]f[eé]rencement|\bseo\b/i,
  /partenariat|partnership/i,
  /collaboration/i,
  /notre (?:groupe|soci[eé]t[eé]|entreprise)|our (?:company|group)/i,
  /on behalf of/i,
  /vice president|sales manager|directeur (?:g[eé]n[eé]ral|commercial)/i,
  // « appart » borné : « appartient » (leboncoin réel) n'est pas un hôtelier.
  /r[eé]sidence|appartement|appart-h[oô]tel|h[oô]tel\b|h[eé]bergement/i,
  /tarif partenaire/i,
  /product catalog|\brfq\b|trading|cooperation terms/i,
  // Candidatures spontanées via le formulaire (constaté au test à blanc réel) :
  // pas un prospect bateau. PAS de motif « cv » : en nautique, CV = chevaux
  // moteur (« Honda 150 CV ») — faux positif prouvé au harnais.
  /candidature|lettre de motivation|\bstage\b|\bemploi\b|recrutement|alternance/i,
];

// Domaines d'email « personnels » (webmails) : signal de particulier.
const PERSO_DOMAIN = /@(?:gmail|hotmail|outlook|live|yahoo|orange|free|wanadoo|laposte|sfr|icloud|gmx|web|neuf|bbox)\.[a-z.]+$/i;
// Mobile FR (06/07, avec ou sans indicatif +33 / 0033).
const MOBILE_FR = /^(?:\+33|0033)[\s().]*0?[\s().]*[67]|^0[67]/;
// Adresse d'expéditeur commerciale/suspecte (boîte fonctionnelle, TLD exotique).
const SUSPICIOUS_EMAIL = /^(?:sales|info|contact|marketing|noreply|no-reply)\d*@|\.(?:lat|xyz|top|icu|click)$/i;

const clamp = (n: number) => Math.max(0, Math.min(98, Math.round(n)));

export function scoreEmail(source: EmailSourceKind, ex: ExtractResult): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const content = [ex.excerpt, ...ex.notes].join('\n');
  const { extracted: x, flags } = ex;

  // Administratif (facture / cotation) : à écarter, pas un prospect.
  if (flags.isAdmin) {
    return { score: 5, reasons: ['Administratif (facture / cotation) — pas un prospect'] };
  }

  const promoHits = PROMO.filter(r => r.test(content));
  // Un démarcheur dit volontiers « intéressé par votre activité » : dès 2
  // signaux de démarchage, le bonus d'intention est NEUTRALISÉ (calibré sur
  // les parasites réels de l'échantillon, qui cumulent 3-5 signaux).
  const intentHit = promoHits.length >= 2 ? undefined : content.match(INTENT)?.[1];
  const persoEmail = PERSO_DOMAIN.test(x.email);
  const mobileFr = MOBILE_FR.test(x.phone.replace(/[\s.-]/g, ''));

  let score: number;
  switch (source) {
    case 'boatscom': {
      // Source fiable à 100 % sur l'échantillon (toujours INTERESTED-IN).
      score = 90;
      reasons.push('Format boats.com (INTERESTED-IN) : fiabilité maximale');
      if (x.boatInterest) reasons.push(`Bateau précis (${x.boatInterest})`);
      if (x.phone) reasons.push('Téléphone + email fournis');
      else { score -= 5; reasons.push('Pas de téléphone fourni'); }
      if (flags.hasLeadSmart) { score += 5; reasons.push('LeadSmart : acheteur actif (autres demandes récentes)'); }
      break;
    }
    case 'site': {
      // Formulaire public : la source la plus bruitée, tout se joue au contenu.
      score = 45;
      if (intentHit) { score += 20; reasons.push(`Intention nautique claire (« ${intentHit.toLowerCase()} »)`); }
      if (x.brand) { score += 10; reasons.push(`Bateau / marque identifié (${x.brand})`); }
      if (mobileFr) { score += 8; reasons.push('Mobile FR personnel'); }
      if (persoEmail) { score += 7; reasons.push('Email personnel (webmail)'); }
      break;
    }
    case 'leboncoin': {
      score = 55;
      if (x.boatInterest) { score += 10; reasons.push(`Annonce identifiée (${x.boatInterest})`); }
      if (flags.richFormat) { score += 15; reasons.push('Format récent : coordonnées étiquetées complètes'); }
      else reasons.push('Format ancien : email + pseudo seulement, à compléter');
      if (intentHit) { score += 10; reasons.push(`Intention claire (« ${intentHit.toLowerCase()} »)`); }
      break;
    }
    case 'bandofboats': {
      score = 50;
      if (x.email) { score += 8; reasons.push('Email du prospect fourni'); }
      else reasons.push('Réponse via la plateforme uniquement');
      if (x.boatInterest) { score += 10; reasons.push(`Annonce identifiée (${x.boatInterest})`); }
      if (intentHit) { score += 10; reasons.push(`Intention claire (« ${intentHit.toLowerCase()} »)`); }
      if (flags.isAutoNotification) { score -= 15; reasons.push('Notification automatique (annonce téléchargée) — pas un message du prospect'); }
      break;
    }
    default: {
      score = 30;
      reasons.push('Source inconnue — vérification manuelle nécessaire');
      if (intentHit) { score += 10; reasons.push(`Intention claire (« ${intentHit.toLowerCase()} »)`); }
    }
  }

  // Pénalités transverses (spec : signaux de parasite).
  if (promoHits.length > 0) {
    score -= Math.min(60, 30 + 10 * (promoHits.length - 1));
    reasons.push(`Démarchage probable : parle de son offre (${promoHits.length} ${promoHits.length > 1 ? 'signaux' : 'signal'})`);
    if (x.email && !persoEmail) { score -= 10; reasons.push('Adresse d\'entreprise tierce'); }
  }
  if (x.email && SUSPICIOUS_EMAIL.test(x.email)) {
    score -= 25;
    reasons.push('Adresse email commerciale / suspecte');
  }

  return { score: clamp(score), reasons };
}
