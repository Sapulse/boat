/**
 * Harnais de la boîte de réception prospects (Étape A, maquette).
 *
 * Exécution : npx tsx scripts/harness-inbound.ts
 *
 * Prouve le module PUR src/lib/inbound.ts (seuils de score, tri de la file,
 * mapping email -> lead) et les INVARIANTS des fixtures de démo (ids uniques,
 * leadSource ∈ SOURCES, scores bornés, cas doublon voulu présent).
 */
import {
  scoreLevel, sortInboundByScore, buildLeadFromInbound,
  inboundDisplayName, parseReceivedAt, formatReceivedAge, formatReceivedShort, scoreReasonSign,
  shouldOfferReopen, REOPEN_TARGET_STATUS, REOPENABLE_LEAD_STATUSES,
} from '../src/lib/inbound';
import { LEAD_STATUSES } from '../src/data/constants';
import { isLeadActive } from '../src/lib/utils';
import { extractLeboncoin } from '../src/lib/email/extractors';
import { scoreEmail } from '../src/lib/email/score';
import type { ExtractResult } from '../src/lib/email/types';
import { MOCK_INBOUND_EMAILS } from '../src/data/mockInboundEmails';
import { normEmail, normPhone } from '../src/lib/duplicateLeads';
import { SOURCES } from '../src/data/constants';
import type { InboundEmail } from '../src/data/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

function mail(over: Partial<InboundEmail>): InboundEmail {
  return {
    id: 'm1', receivedAt: '2026-07-28 10:00', fromAddress: 'a@b.c', subject: 'Objet',
    excerpt: 'Message.', sourceLabel: 'Formulaire du site', leadSource: 'Site BOB',
    score: 50, scoreReasons: [], status: 'a_traiter',
    extracted: { firstName: 'A', lastName: 'B', email: 'a@b.c', phone: '0611223344', boatInterest: 'X', brand: 'Y' },
    ...over,
  };
}

function main() {
  section('scoreLevel : seuils 70 / 40');
  check('92 -> prospect', scoreLevel(92) === 'prospect');
  check('70 -> prospect (borne incluse)', scoreLevel(70) === 'prospect');
  check('69 -> a_verifier', scoreLevel(69) === 'a_verifier');
  check('40 -> a_verifier (borne incluse)', scoreLevel(40) === 'a_verifier');
  check('39 -> parasite', scoreLevel(39) === 'parasite');
  check('0 -> parasite', scoreLevel(0) === 'parasite');

  section('sortInboundByScore : score décroissant, récent d\'abord à égalité');
  const sorted = sortInboundByScore([
    mail({ id: 'low', score: 10 }),
    mail({ id: 'high', score: 90 }),
    mail({ id: 'mid-old', score: 50, receivedAt: '2026-07-26 08:00' }),
    mail({ id: 'mid-new', score: 50, receivedAt: '2026-07-28 08:00' }),
  ]);
  check('ordre high > mid-new > mid-old > low',
    sorted.map(m => m.id).join(',') === 'high,mid-new,mid-old,low',
    sorted.map(m => m.id).join(','));
  const input = [mail({ id: 'a', score: 1 }), mail({ id: 'b', score: 2 })];
  sortInboundByScore(input);
  check('ne mute pas le tableau d\'entrée', input[0].id === 'a');

  section('buildLeadFromInbound : mapping vers Omit<Lead, "id">');
  const src = mail({ score: 92, sourceDetail: 'YachtWorld' });
  const lead = buildLeadFromInbound(src, 'fred', '2026-07-28');
  check('source = leadSource', lead.source === 'Site BOB');
  check('commercial repris', lead.commercialId === 'fred');
  check('identité et coordonnées reprises',
    lead.firstName === 'A' && lead.lastName === 'B' && lead.email === 'a@b.c' && lead.phone === '0611223344');
  check('bateau repris', lead.boatInterest === 'X' && lead.brand === 'Y');
  check('statut nouveau', lead.status === 'nouveau');
  check('createdAt et contactDate = jour de validation', lead.createdAt === '2026-07-28' && lead.contactDate === '2026-07-28');
  check('commentaires : provenance + détail + objet + message',
    lead.comments.includes('Formulaire du site — YachtWorld') && lead.comments.includes('Objet : Objet') && lead.comments.includes('Message.'));
  check('température NEUTRE : tiède, quel que soit le score (le système ne la décide plus)',
    lead.temperature === 'tiede'
    && buildLeadFromInbound(mail({ score: 50 }), 'fred', '2026-07-28').temperature === 'tiede');
  check('« Non attribué » : commercialId vide accepté', buildLeadFromInbound(src, '', '2026-07-28').commercialId === '');

  section('Fixtures de démo : invariants');
  const ids = MOCK_INBOUND_EMAILS.map(m => m.id);
  check('ids uniques', new Set(ids).size === ids.length);
  check('tous « à traiter » au chargement', MOCK_INBOUND_EMAILS.every(m => m.status === 'a_traiter'));
  check('scores bornés 0..100', MOCK_INBOUND_EMAILS.every(m => m.score >= 0 && m.score <= 100));
  const badSources = MOCK_INBOUND_EMAILS.filter(m => !SOURCES.includes(m.leadSource));
  check('leadSource ∈ SOURCES (spec §4)', badSources.length === 0, badSources.map(m => m.leadSource).join(','));
  check('les 3 niveaux de score sont représentés',
    new Set(MOCK_INBOUND_EMAILS.map(m => scoreLevel(m.score))).size === 3);

  section('Cas doublon voulu : boats.com et relance site = même prospect');
  const boats = MOCK_INBOUND_EMAILS.find(m => m.id === 'in-boats-antares');
  const relance = MOCK_INBOUND_EMAILS.find(m => m.id === 'in-site-relance');
  check('les deux fixtures existent', !!boats && !!relance);
  if (boats && relance) {
    check('même email normalisé', normEmail(boats.extracted.email) === normEmail(relance.extracted.email));
    check('même téléphone normalisé (formats différents)', normPhone(boats.extracted.phone) === normPhone(relance.extracted.phone));
  }

  const noName = { firstName: '', lastName: '', email: '', phone: '', boatInterest: '', brand: '' };

  section('Titre de carte : QUI écrit (proposition 1)');
  {
    check('nom complet quand il est extrait',
      inboundDisplayName(mail({ extracted: { ...noName, firstName: 'Marc', lastName: 'Le Goff', email: 'm@x.fr' } })) === 'Marc Le Goff');
    check('prénom seul suffit',
      inboundDisplayName(mail({ extracted: { ...noName, firstName: 'Marc', email: 'm@x.fr' } })) === 'Marc');
    check('sans nom -> email extrait, plutôt que « (sans nom) »',
      inboundDisplayName(mail({ extracted: { ...noName, email: 'm@x.fr' } })) === 'm@x.fr');
    check("sans nom ni email -> adresse d'expédition",
      inboundDisplayName(mail({ fromAddress: 'exp@site.fr', extracted: { ...noName } })) === 'exp@site.fr');
    check('JAMAIS de titre vide (une carte sans titre est illisible)',
      inboundDisplayName(mail({ fromAddress: '   ', extracted: { ...noName, firstName: ' ', email: '  ' } })) === 'Expéditeur inconnu');
  }

  section('Date de réception lisible (proposition 1)');
  {
    // Les DEUX formats en circulation : ISO UTC (collecteur réel) et fixtures démo.
    check('format ISO du collecteur réel accepté', parseReceivedAt('2026-07-28T11:17:00Z') !== null);
    check('format des fixtures de démo accepté', parseReceivedAt('2026-07-28 10:00') !== null);
    check("valeur illisible -> null (jamais « Invalid Date »)", parseReceivedAt('nimporte quoi') === null);
    check("date illisible -> on réaffiche la chaîne d'origine", formatReceivedShort('pas-une-date') === 'pas-une-date');

    const now = new Date('2026-07-28T12:00:00Z');
    check("moins de 2 min -> « à l'instant »", formatReceivedAge('2026-07-28T11:59:30Z', now) === "à l'instant");
    check('minutes', formatReceivedAge('2026-07-28T11:30:00Z', now) === 'il y a 30 min');
    check('heures', formatReceivedAge('2026-07-28T09:00:00Z', now) === 'il y a 3 h');
    check('jours', formatReceivedAge('2026-07-25T12:00:00Z', now) === 'il y a 3 j');
    check('bascule à 24 h -> « 1 j », pas « 24 h »', formatReceivedAge('2026-07-27T12:00:00Z', now) === 'il y a 1 j');
    check("date FUTURE (horloge décalée) -> rien plutôt qu'un négatif",
      formatReceivedAge('2026-07-29T12:00:00Z', now) === '');
    check('date illisible -> chaîne vide, aucun plantage', formatReceivedAge('zzz', now) === '');
  }

  section('Signaux de score séparés + / − (proposition 7)');
  {
    check('« Administratif… » est NÉGATIF',
      scoreReasonSign('Administratif (facture / cotation) — pas un prospect') === 'negatif');
    check('« Démarchage probable… (3 signaux) » est NÉGATIF malgré le compte variable',
      scoreReasonSign('Démarchage probable : parle de son offre (3 signaux)') === 'negatif');
    check('« Pas de téléphone fourni » est NÉGATIF', scoreReasonSign('Pas de téléphone fourni') === 'negatif');
    check('« Téléphone + email fournis » est POSITIF', scoreReasonSign('Téléphone + email fournis') === 'positif');
    check('« Intention nautique claire… » est POSITIF',
      scoreReasonSign('Intention nautique claire (« devis »)') === 'positif');
    check('« Format récent… » est POSITIF', scoreReasonSign('Format récent : coordonnées étiquetées complètes') === 'positif');
    check('« Format ancien… » est NÉGATIF (le préfixe voisin ne trompe pas)',
      scoreReasonSign('Format ancien : email + pseudo seulement, à compléter') === 'negatif');
    check('raison inconnue -> « inconnu », JAMAIS positif par défaut',
      scoreReasonSign('Un libellé que personne na classé') === 'inconnu');
    check('chaîne vide -> inconnu', scoreReasonSign('   ') === 'inconnu');

    // GARDE-FOU : on fait tourner le VRAI scoreEmail sur toutes les sources et on
    // exige qu'AUCUNE raison produite ne ressorte « inconnue ». Ajouter une raison
    // dans score.ts sans la classer dans inbound.ts casse donc ce test, bruyamment.
    const ex = (over: Partial<ExtractResult> = {}): ExtractResult => ({
      extracted: { firstName: 'A', lastName: 'B', email: 'a@gmail.com', phone: '0611223344', boatInterest: 'Antares 9', brand: 'Beneteau' },
      excerpt: 'Bonjour, je suis intéressé par ce bateau, avez-vous un devis ?',
      notes: [],
      flags: {},
      ...over,
    });
    const cases: Array<{ label: string; reasons: string[] }> = [
      { label: 'boats.com complet', reasons: scoreEmail('boatscom', ex({ flags: { hasLeadSmart: true } })).reasons },
      { label: 'boats.com sans téléphone', reasons: scoreEmail('boatscom', ex({ extracted: { firstName: 'A', lastName: 'B', email: 'a@gmail.com', phone: '', boatInterest: 'X', brand: '' } })).reasons },
      { label: 'formulaire du site', reasons: scoreEmail('site', ex()).reasons },
      { label: 'leboncoin format récent', reasons: scoreEmail('leboncoin', ex({ flags: { richFormat: true } })).reasons },
      { label: 'leboncoin format ancien', reasons: scoreEmail('leboncoin', ex()).reasons },
      { label: 'band of boats + notification auto', reasons: scoreEmail('bandofboats', ex({ flags: { isAutoNotification: true } })).reasons },
      { label: 'administratif', reasons: scoreEmail('bandofboats', ex({ flags: { isAdmin: true } })).reasons },
      { label: 'source inconnue', reasons: scoreEmail('inconnu', ex()).reasons },
      {
        label: 'démarchage (refonte de site)',
        reasons: scoreEmail('site', ex({
          excerpt: 'Nous proposons une refonte de sites internet et du référencement SEO pour notre groupe.',
          extracted: { firstName: 'A', lastName: 'B', email: 'sales@agence.xyz', phone: '', boatInterest: '', brand: '' },
        })).reasons,
      },
    ];
    const unclassified: string[] = [];
    for (const c of cases) {
      for (const r of c.reasons) if (scoreReasonSign(r) === 'inconnu') unclassified.push(`[${c.label}] ${r}`);
    }
    check("AUCUNE raison produite par le vrai scoreEmail n'est non classée",
      unclassified.length === 0, unclassified.join(' | '));
    check('les cas de test produisent bien des raisons à classer',
      cases.every(c => c.reasons.length > 0));
  }

  // ------------------------------------------------------------------------
  // Mises en FAVORI Leboncoin (retour terrain 2026-08).
  //
  // Testé ICI plutôt que dans harness-parse-email : ce dernier dépend d'un
  // fichier d'attentes gitignoré (vrais emails), donc il est SAUTÉ en CI. Une
  // règle métier de cette importance doit être couverte par un test qui tourne.
  // ------------------------------------------------------------------------
  section('Favoris Leboncoin : détection');
  {
    const env = (subject: string, body: string, fromName = 'pseudo via leboncoin') => ({
      fromName, fromAddress: 'abc@messagerie.leboncoin.fr', subject, body,
    });

    // Le VRAI cas collecté le 2026-07-23.
    const favori = extractLeboncoin(env(
      'Un nouveau contact pour "Voilier - BENETEAU FIRST 41S5" sur leboncoin',
      'Votre bien est toujours disponible ? Faites-le lui savoir.\n59 900 €\n',
    ));
    check('favori détecté', favori.flags.isFavoriteNotice === true);
    check('aucune coordonnée extraite (c\'est le fond du problème)',
      favori.extracted.email === '' && favori.extracted.phone === '');
    check('annonce quand même identifiée depuis l\'objet',
      favori.extracted.boatInterest === 'Voilier - BENETEAU FIRST 41S5', favori.extracted.boatInterest);
    check('sourceDetail explicite', favori.sourceDetail === 'mise en favori (notification automatique)', favori.sourceDetail);

    // Objet transféré (« TR: ») : la détection ne doit PAS être ancrée en début.
    const transfere = extractLeboncoin(env(
      'TR: Un nouveau contact pour "Zodiac Pro 6.5" sur leboncoin',
      'Votre bien est toujours disponible ? Faites-le lui savoir.\n',
    ));
    check('objet transféré (préfixe TR:) détecté aussi', transfere.flags.isFavoriteNotice === true);

    // Marqueurs INDÉPENDANTS : chacun suffit seul.
    const objetSeul = extractLeboncoin(env('Un nouveau contact pour "X" sur leboncoin', 'Corps sans gabarit.\n'));
    check('objet seul suffit', objetSeul.flags.isFavoriteNotice === true);
    const corpsSeul = extractLeboncoin(env('Objet remanié par leboncoin', 'Faites-le lui savoir.\n'));
    check('gabarit du corps seul suffit', corpsSeul.flags.isFavoriteNotice === true);
  }

  section('Favoris Leboncoin : les VRAIS messages ne sont PAS pénalisés');
  {
    const env = (subject: string, body: string, fromName = 'pseudo via leboncoin') => ({
      fromName, fromAddress: 'abc@messagerie.leboncoin.fr', subject, body,
    });

    // Format RÉCENT (coordonnées étiquetées) — cas réel du 2026-07-25.
    const recent = extractLeboncoin(env(
      'Nouveau message pour "Semi-rigide - Zodiac Pro 6.5" sur leboncoin',
      'Prénom : Marc\nNom : Le Goff\nE-mail : marc@exemple.fr\nTéléphone : 0611223344\nVille : Brest\n'
      + '« Bonjour, votre annonce m\'intéresse ! Est-elle toujours disponible ? »\n53 900 €\n',
    ));
    check('format RÉCENT : pas marqué favori', recent.flags.isFavoriteNotice === false, String(recent.flags.isFavoriteNotice));
    check('format RÉCENT : reconnu comme riche', recent.flags.richFormat === true);
    check('format RÉCENT : coordonnées extraites',
      recent.extracted.email === 'marc@exemple.fr' && recent.extracted.phone === '0611223344');

    // Format ANCIEN (email + pseudo seulement) — l'autre format de la spec.
    const ancien = extractLeboncoin(env(
      'Nouveau message pour "Coque open - FLYER 6" sur leboncoin',
      'E-mail : p@exemple.fr\n« Bonjour, disponible ? »\n35 900 €\n',
    ));
    check('format ANCIEN : pas marqué favori', ancien.flags.isFavoriteNotice === false, String(ancien.flags.isFavoriteNotice));
    check('format ANCIEN : pas riche, mais email extrait',
      ancien.flags.richFormat === false && ancien.extracted.email === 'p@exemple.fr');

    // Scores : le favori descend, les vrais messages NE BOUGENT PAS.
    const sFavori = scoreEmail('leboncoin', favoriExtract());
    const sRecent = scoreEmail('leboncoin', recent);
    const sAncien = scoreEmail('leboncoin', ancien);

    check(`favori : score ${sFavori.score} — sous « prospect probable » (70)`, sFavori.score < 70, String(sFavori.score));
    check(`favori : score ${sFavori.score} — AU-DESSUS du seuil de repli (40), donc VISIBLE`,
      sFavori.score >= 40, String(sFavori.score));
    check('favori : niveau « à vérifier », ni prospect ni parasite',
      scoreLevel(sFavori.score) === 'a_verifier', scoreLevel(sFavori.score));
    check('favori : la raison est explicite',
      sFavori.reasons.some(r => r.startsWith('Mise en favori')), sFavori.reasons.join(' | '));
    check('favori : le bonus d\'INTENTION n\'est PLUS appliqué (cause racine)',
      !sFavori.reasons.some(r => r.startsWith('Intention')), sFavori.reasons.join(' | '));
    check('favori : pas de « Format ancien » parasite dans les raisons',
      !sFavori.reasons.some(r => r.startsWith('Format ancien')), sFavori.reasons.join(' | '));

    check(`vrai message RÉCENT : score ${sRecent.score} inchangé (>= 70, prospect)`,
      sRecent.score >= 70 && scoreLevel(sRecent.score) === 'prospect', String(sRecent.score));
    check(`vrai message ANCIEN : score ${sAncien.score} inchangé (>= 40)`,
      sAncien.score >= 40, String(sAncien.score));
    check('vrai message : aucune raison « Mise en favori »',
      !sRecent.reasons.some(r => r.startsWith('Mise en favori'))
      && !sAncien.reasons.some(r => r.startsWith('Mise en favori')));
    check('le favori score STRICTEMENT moins que les deux vrais formats',
      sFavori.score < sRecent.score && sFavori.score < sAncien.score,
      `${sFavori.score} vs ${sRecent.score} / ${sAncien.score}`);
  }

  section('Température : le système ne la décide PLUS (retour terrain 2026-09)');
  {
    // L'équipe pose la température elle-même. AUCUNE dimension de l'email ne doit
    // plus la faire varier : ni la note, ni la présence de coordonnées. C'est le
    // sens de cette section — elle prouve une ABSENCE de règle.
    const noContact = mail({
      score: 90, // volontairement TRÈS haut : la note ne décide plus de rien
      extracted: { firstName: '', lastName: '', email: '', phone: '', boatInterest: 'Antares 9', brand: 'Beneteau' },
    });
    check('injoignable + score 90 -> tiède (plus de « froid » dérivé)',
      buildLeadFromInbound(noContact, 'fred', '2026-07-28').temperature === 'tiede',
      buildLeadFromInbound(noContact, 'fred', '2026-07-28').temperature);

    const emailOnly = mail({ score: 90, extracted: { firstName: '', lastName: '', email: 'a@b.c', phone: '', boatInterest: '', brand: '' } });
    check('joignable + score 90 -> tiède (plus de « chaud » dérivé)',
      buildLeadFromInbound(emailOnly, 'fred', '2026-07-28').temperature === 'tiede',
      buildLeadFromInbound(emailOnly, 'fred', '2026-07-28').temperature);

    // Balayage de toute la plage de notes, seuils compris : la température est
    // CONSTANTE. Un futur ajout de règle casse forcément cette assertion.
    const scores = [0, 20, 39, 40, 45, 55, 69, 70, 75, 90, 100];
    check('température constante sur toute la plage de scores',
      scores.every(s => buildLeadFromInbound(mail({ score: s }), 'fred', '2026-07-28').temperature === 'tiede'));

    // Ce qui reste automatique, LUI : le score. Le correctif du favori Leboncoin
    // (45) tient sans sa partie température — c'est le score qui trie la file.
    check('le SCORE reste le signal : 45 = à vérifier, jamais « prospect probable »',
      scoreLevel(45) === 'a_verifier');
  }

  section('Rattachement à un lead clos : PROPOSER de rouvrir, jamais le faire');
  {
    check('perdu / reporté / signé -> proposition',
      shouldOfferReopen('perdu') && shouldOfferReopen('reporte') && shouldOfferReopen('signe'));
    // Balayage de TOUS les statuts connus : seuls les trois clos proposent. Un
    // statut ajouté plus tard ne déclenche rien tant qu'on ne l'a pas décidé.
    const offering = LEAD_STATUSES.map(s => s.value).filter(shouldOfferReopen).sort();
    check('aucun autre statut ne propose de rouvrir',
      JSON.stringify(offering) === JSON.stringify(['perdu', 'reporte', 'signe']), offering.join(','));
    check('chaque statut « rouvrable » est bien HORS des statuts actifs',
      REOPENABLE_LEAD_STATUSES.every(s => !isLeadActive(s)));
    check('rouvrir -> « À contacter »', REOPEN_TARGET_STATUS === 'a_contacter');
    check('le statut cible est ACTIF (le lead revient dans les vues de travail)',
      isLeadActive(REOPEN_TARGET_STATUS));
    check('le statut cible ne re-propose pas (pas de boucle)', !shouldOfferReopen(REOPEN_TARGET_STATUS));
  }

  console.log(`\n${passed} OK, ${failed} KO`);
  if (failed > 0) process.exit(1);
}

/** L'extraction du favori réel, rejouée pour la section des scores. */
function favoriExtract() {
  return extractLeboncoin({
    fromName: 'pseudo via leboncoin', fromAddress: 'abc@messagerie.leboncoin.fr',
    subject: 'Un nouveau contact pour "Voilier - BENETEAU FIRST 41S5" sur leboncoin',
    body: 'Votre bien est toujours disponible ? Faites-le lui savoir.\n59 900 €\n',
  });
}

main();
