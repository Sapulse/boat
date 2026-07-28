import type { EmailEnvelope } from './forward';
import type { ExtractResult } from './types';

// Un extracteur par famille de source (spec §2), calibrés sur les 23 emails
// réels de l'échantillon (docs/emails-echantillon, non commité). Chaque
// extracteur reçoit l'enveloppe DÉBALLÉE (forward.ts) et ne renvoie que ce
// qu'il sait lire de façon fiable — le reste part en notes ou reste vide
// (l'écran de validation permet de compléter à la main).

// Marques nautiques connues pour détecter `brand` dans un texte libre.
// Détection par SOUS-CHAÎNE insensible à la casse/accents ('zodiaque' matche
// 'zodiac'). Liste volontairement courte : mieux vaut un champ vide qu'une
// fausse marque.
const KNOWN_BRANDS: { key: string; label: string }[] = [
  { key: 'beneteau', label: 'Bénéteau' },
  { key: 'jeanneau', label: 'Jeanneau' },
  { key: 'highfield', label: 'Highfield' },
  { key: 'zodiac', label: 'Zodiac' },
  { key: 'zodiaqu', label: 'Zodiac' }, // orthographe libre réelle (« un zodiaque »)
  { key: 'axopar', label: 'Axopar' },
  { key: 'quicksilver', label: 'Quicksilver' },
  { key: 'rhea', label: 'Rhea' },
  { key: 'bombard', label: 'Bombard' },
  { key: 'capelli', label: 'Capelli' },
  { key: 'reinke', label: 'Reinke' },
];

function normText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function detectBrand(text: string): string {
  const n = normText(text);
  return KNOWN_BRANDS.find(b => n.includes(b.key))?.label ?? '';
}

/** "Camille Martin" -> prénom/nom ; un seul mot (pseudo) -> nom seul. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: '', lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** Valeur d'un champ étiqueté « Label:   valeur » (même ligne). */
function labeled(text: string, label: string): string {
  const m = text.match(new RegExp(`^[ \\t]*${label}\\s*:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

/** Nettoie une valeur email Outlook : "x@y.fr<mailto:x@y.fr>" -> "x@y.fr". */
function cleanEmail(v: string): string {
  return v.split('<')[0].trim();
}

const EMPTY_EXTRACTED = { firstName: '', lastName: '', email: '', phone: '', boatInterest: '', brand: '' };

// ---------------------------------------------------------------------------
// boats.com / BoatWizard — format machine étiqueté, identique sur les 6
// plateformes du réseau. La section INFOS BUREAU (nos propres coordonnées)
// est coupée AVANT extraction : elle contient aussi un champ « Nom: ».
// ---------------------------------------------------------------------------
export function extractBoatscom(env: EmailEnvelope): ExtractResult {
  const cut = env.body.split(/INFOS BUREAU/)[0];
  const name = splitName(labeled(cut, 'Nom'));
  const marque = labeled(cut, 'Marque');
  const modele = labeled(cut, 'Modèle');
  const annee = labeled(cut, 'Année');
  const origine = labeled(cut, 'Origine du contact');

  // Message libre du prospect : les lignes AVANT le bloc PROSPECT INDIVIDUEL,
  // débarrassées des liens d'acquittement BoatWizard.
  const excerpt = cut.split(/PROSPECT INDIVIDUEL/)[0]
    .split(/\r?\n/)
    .filter(l => l.trim() && !/^Click here/i.test(l.trim()) && !/^https?:\/\//.test(l.trim()))
    .join('\n')
    .trim();

  const notes: string[] = [];
  let hasLeadSmart = false;
  const ls = cut.match(/\* \* LEADSMART \* \*\s*([\s\S]*?)(?=INFOS PROSPECT|$)/);
  if (ls && ls[1].trim() && !/Aucun historique/i.test(ls[1])) {
    hasLeadSmart = true;
    notes.push(`LeadSmart — autres demandes récentes du prospect :\n${ls[1].trim()}`);
  }
  const url = labeled(cut, 'URL');
  if (url) notes.push(`Annonce : ${url}`);

  return {
    extracted: {
      ...name,
      email: cleanEmail(labeled(cut, 'E-mail')),
      phone: labeled(cut, 'Téléphone'),
      boatInterest: modele ? `${modele}${annee ? ` (${annee})` : ''}` : '',
      brand: marque || detectBrand(env.subject),
    },
    sourceDetail: origine || undefined,
    excerpt,
    notes,
    flags: { hasLeadSmart },
  };
}

// ---------------------------------------------------------------------------
// Formulaire du site — étiquettes SUR LEUR PROPRE LIGNE (Nom / Prenom / Tél /
// Email / Adresse / Code postal / Ville), valeur à la ligne non vide suivante.
// Le message libre suit la dernière valeur, jusqu'au pied fixe (cases de
// consentement ✔/✘ + mention Infocob). La case « communications » est lue :
// donnée RGPD utile (consentement marketing du prospect).
// ---------------------------------------------------------------------------
const SITE_LABELS: Record<string, string> = {
  'nom': 'lastName',
  'prenom': 'firstName',
  'tel': 'phone',
  'email': 'email',
  'e-mail': 'email',
  'adresse': 'adresse',
  'code postal': 'cp',
  'ville': 'ville',
};
const SITE_STOP = /^(?:✔|✘|Oui, j'accepte|Accepte la politique|Ce message a été envoyé)/;

export function extractSite(env: EmailEnvelope): ExtractResult {
  const lines = env.body.split(/\r?\n/).map(l => l.trim());
  const fields: Record<string, string> = {};
  let lastFieldEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const key = SITE_LABELS[normText(lines[i])];
    if (!key || fields[key] !== undefined) continue;
    // Valeur = prochaine ligne non vide qui n'est ni une étiquette ni du bruit.
    for (let j = i + 1; j < lines.length; j++) {
      const v = lines[j];
      if (!v || /^\[cid:/i.test(v)) continue;
      if (SITE_LABELS[normText(v)] !== undefined) break; // champ laissé vide
      fields[key] = key === 'email' ? cleanEmail(v) : v;
      lastFieldEnd = j;
      break;
    }
  }

  // Message libre : après la dernière valeur de champ, jusqu'au pied fixe.
  const msgLines: string[] = [];
  for (let i = lastFieldEnd + 1; i < lines.length; i++) {
    if (SITE_STOP.test(lines[i])) break;
    msgLines.push(lines[i]);
  }
  const excerpt = msgLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const notes: string[] = [];
  const adresse = [fields.adresse, [fields.cp, fields.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (adresse) notes.push(`Adresse : ${adresse}`);
  // Consentement communications : la case (✔/✘) précède la phrase sur sa propre ligne.
  const consentIdx = lines.findIndex(l => /^Oui, j'accepte de recevoir des communications/.test(l));
  if (consentIdx > 0) {
    const mark = lines.slice(0, consentIdx).reverse().find(l => l !== '');
    if (mark === '✔' || mark === '✘') {
      notes.push(`Consentement communications commerciales : ${mark === '✔' ? 'OUI' : 'NON'} (case du formulaire)`);
    }
  }

  return {
    extracted: {
      firstName: fields.firstName ?? '',
      lastName: fields.lastName ?? '',
      email: fields.email ?? '',
      phone: fields.phone ?? '',
      boatInterest: '',
      brand: detectBrand(excerpt),
    },
    excerpt,
    notes,
    flags: {},
  };
}

// ---------------------------------------------------------------------------
// Leboncoin — deux formats. Récent : Prénom/Nom/E-mail/Téléphone/Ville
// étiquetés en ligne. Ancien : E-mail seul + pseudo (extrait de « X via
// leboncoin ») et le VRAI premier message enfoui en bas du fil « Messages
// précédents ». Dans les deux cas : bateau dans l'objet, prix dans le corps.
// ---------------------------------------------------------------------------
export function extractLeboncoin(env: EmailEnvelope): ExtractResult {
  const b = env.body;
  const prenom = labeled(b, 'Prénom');
  const nom = labeled(b, 'Nom');
  const phone = labeled(b, 'Téléphone');
  const email = cleanEmail(labeled(b, 'E-mail'));
  const ville = labeled(b, 'Ville');
  const rich = !!(prenom || nom);
  const pseudo = env.fromName.replace(/\s+via leboncoin$/i, '').trim();

  const boat = env.subject.match(/pour\s+"(.+?)"\s+sur leboncoin/i)?.[1] ?? '';
  // Message courant entre guillemets français (peut être creux sur le format ancien).
  const quoted = b.match(/«\s*([\s\S]*?)\s*»/)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';

  const notes: string[] = [];
  if (ville) notes.push(`Ville : ${ville}`);
  const price = b.match(/^(\d[\d\s]*)\s?€$/m)?.[1]?.replace(/\s/g, '');
  if (price) notes.push(`Annonce : ${Number(price).toLocaleString('fr-FR')} €${boat ? ` — ${boat}` : ''}`);

  // Fil « Messages précédents » (du plus récent au plus ancien) : le dernier
  // message d'un auteur ≠ Brest Ocean Boat / leboncoin = le PREMIER contact du
  // prospect — souvent le seul contenu utile du format ancien.
  const threadStart = b.search(/Messages précédents/);
  if (threadStart !== -1) {
    const lines = b.slice(threadStart).split(/\r?\n/).map(l => l.trim());
    const isDate = (l: string) => /^\d{1,2} \S+ \d{4} \d{2}:\d{2}:\d{2}$/.test(l);
    let firstMsg = '';
    for (let i = 0; i < lines.length; i++) {
      if (!isDate(lines[i])) continue;
      const author = lines.slice(0, i).reverse().find(l => l !== '') ?? '';
      if (/BREST OCEAN BOAT|^leboncoin$/i.test(author)) continue;
      const msg: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (!l) continue;
        if (isDate(lines[j + 1] ?? '') || /^\[/.test(l) || /^Lien :/.test(l)) break;
        msg.push(l);
        break; // un message du fil tient sur une ligne dans le rendu texte
      }
      if (msg.length) firstMsg = msg.join(' '); // le dernier trouvé = le plus ancien
    }
    if (firstMsg && firstMsg !== quoted) {
      notes.push(`Fil Leboncoin — premier message du prospect : « ${firstMsg} »`);
    }
  }

  return {
    extracted: {
      firstName: prenom,
      lastName: nom || (rich ? '' : pseudo),
      email,
      phone,
      boatInterest: boat,
      brand: detectBrand(boat),
    },
    sourceDetail: rich ? 'format récent (étiqueté)' : 'format ancien (fil de messages)',
    excerpt: quoted,
    notes,
    flags: { richFormat: rich },
  };
}

// ---------------------------------------------------------------------------
// Band of Boats — écart favorable vs spec : nom ET email du prospect présents
// (+ Ref Infocob, bateau/année/prix). Même expéditeur pour les vrais messages,
// les notifications automatiques (PDF téléchargé) et l'administratif
// (facture / cotation) -> le tri se fait sur objet + contenu.
// ---------------------------------------------------------------------------
export function extractBandofboats(env: EmailEnvelope): ExtractResult {
  const b = env.body;

  if (/facture|cotation/i.test(env.subject)) {
    const excerpt = b.split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 40 && !l.includes('<http') && !l.startsWith('['))
      .slice(0, 2)
      .join('\n');
    return { extracted: { ...EMPTY_EXTRACTED }, excerpt, notes: [], flags: { isAdmin: true } };
  }

  const name = splitName(b.match(/^(.*?) vient de vous envoyer un message/m)?.[1] ?? '');
  const email = cleanEmail(labeled(b, 'E-mail'));
  const boat = (b.match(/à propos de votre (.+)$/m)?.[1] ?? env.subject.match(/à propos de votre (.+)$/)?.[1] ?? '').trim();
  const year = b.match(/^((?:19|20)\d{2})$/m)?.[1] ?? '';

  const notes: string[] = [];
  const ref = b.match(/^Ref \(Infocob\)\s?:\s?(.+)$/m)?.[1]?.trim();
  if (ref) notes.push(`Ref (Infocob) : ${ref}`);
  const langue = b.match(/^Parle (.+?),?$/m)?.[1]?.trim();
  if (langue) notes.push(`Parle : ${langue}`);
  const price = b.match(/^€\s?([\d,. ]+)$/m)?.[1]?.trim();
  if (price) notes.push(`Annonce : ${price} €${boat ? ` — ${boat}` : ''}`);

  // Message : entre la ligne « Parle … » et le bouton « Répondez à … ».
  const lines = b.split(/\r?\n/).map(l => l.trim());
  const start = lines.findIndex(l => /^Parle /.test(l));
  const end = lines.findIndex(l => /^Répondez à /.test(l));
  const excerpt = (start !== -1 && end > start)
    ? lines.slice(start + 1, end).filter(Boolean).join('\n').trim()
    : '';

  return {
    extracted: {
      ...name,
      email,
      phone: '', // jamais de téléphone direct sur cette source
      boatInterest: boat ? `${boat}${year ? ` (${year})` : ''}` : '',
      brand: detectBrand(boat),
    },
    excerpt,
    notes,
    flags: { isAutoNotification: /vient de télécharger la version \.?pdf/i.test(b) },
  };
}

// ---------------------------------------------------------------------------
// Source inconnue — extraction minimale : l'humain complète à la validation.
// ---------------------------------------------------------------------------
export function extractInconnu(env: EmailEnvelope): ExtractResult {
  const excerpt = env.body.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.includes('<http') && !/^https?:\/\//.test(l))
    .slice(0, 8)
    .join('\n');
  return {
    extracted: {
      ...splitName(env.fromName),
      email: env.fromAddress,
      phone: '',
      boatInterest: '',
      brand: detectBrand(`${env.subject}\n${excerpt}`),
    },
    excerpt,
    notes: [],
    flags: {},
  };
}
