import { normalizePhone } from './vcard';

/**
 * Construit un lien sms: pre-rempli.
 *
 * Le schema sms: est bien moins standardise que mailto : la RFC 5724 ne
 * prevoit aucun corps de message. La forme `sms:<numero>?&body=...` est le
 * compromis historique de l'etat de l'art web — iOS attendait `&body=` et
 * Android `?body=`, le `?&` combine les deux et est accepte par les deux
 * plateformes (ainsi que par les apps SMS desktop type Messages/Your Phone).
 *
 * Le numero est nettoye via normalizePhone (retire espaces, points, tirets,
 * parentheses — garde chiffres et '+') ; le corps est encode via
 * encodeURIComponent (accents, retours a la ligne, & ...).
 */
export function buildSms(phone: string, body: string): string {
  return `sms:${normalizePhone(phone)}?&body=${encodeURIComponent(body)}`;
}
