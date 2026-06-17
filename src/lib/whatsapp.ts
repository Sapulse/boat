import { normalizePhone } from './vcard';

// Indicatif pays par defaut pour les numeros saisis au format national (0...).
// L'app est franco-bretonne (Brest Ocean Boat) : 33 = France.
const DEFAULT_COUNTRY_CODE = '33';

/**
 * Convertit un numero au format attendu par wa.me : chiffres uniquement, au
 * format INTERNATIONAL, SANS '+' ni '00' ni 0 national. C'est LA specificite
 * WhatsApp vs sms: — `sms:` accepte le format local, wa.me le refuse.
 *
 * Cas geres (apres normalizePhone qui ne garde que chiffres et '+') :
 *  - '+33 6 12 34 56 78' -> '33612345678'  (indicatif present via '+')
 *  - '0033 6 12 34 56 78' -> '33612345678'  (indicatif present via '00')
 *  - '06 12 34 56 78'      -> '33612345678'  (national FR : 0 -> 33)
 *  - '33612345678'         -> '33612345678'  (deja international : inchange)
 *
 * Limite documentee : un numero NATIONAL etranger sans indicatif (commencant
 * par 0) est presume francais (prefixe 33). Acceptable pour le marche cible ;
 * un numero etranger doit etre saisi au format international (+xx) pour etre
 * route correctement.
 */
export function toWaNumber(phone: string): string {
  let n = normalizePhone(phone); // retire espaces/points/tirets/parentheses, garde chiffres et '+'
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (n.startsWith('0')) n = DEFAULT_COUNTRY_CODE + n.slice(1);
  return n;
}

/**
 * Construit un lien wa.me pre-rempli. wa.me est une URL https (page web /
 * deep-link vers l'app WhatsApp) : a ouvrir via window.open(_blank), pas via
 * window.location (qui quitterait le CRM). Le corps est encode via
 * encodeURIComponent (accents, retours a la ligne, & ...).
 */
export function buildWhatsApp(phone: string, body: string): string {
  return `https://wa.me/${toWaNumber(phone)}?text=${encodeURIComponent(body)}`;
}
