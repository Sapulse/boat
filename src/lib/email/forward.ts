// Déballage des TRANSFERTS internes (diagnostic sur l'échantillon réel : TOUS
// les emails arrivent en « TR: » depuis Contact@brest-ocean-boat.fr, parfois
// imbriqués deux fois avec la signature du transféreur entre les deux). On
// descend au bloc « De : … » le PLUS PROFOND : c'est l'expéditeur d'origine,
// et le corps original commence après son bloc d'en-têtes. En prod (Graph sur
// la boîte Contact), l'expéditeur est déjà propre -> aucun bloc trouvé, repli
// sur les en-têtes de l'email lui-même : le déballage est un no-op.

/** Enveloppe « originale » d'un email, transferts déballés. */
export interface EmailEnvelope {
  fromName: string;
  fromAddress: string;
  subject: string;
  body: string;
}

/** "Nom <adresse>" -> { name, address } ; adresse nue acceptée. */
export function parseAddress(raw: string): { name: string; address: string } {
  const m = raw.match(/^(.*?)<([^<>]+)>\s*$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, '').trim(), address: m[2].trim() };
  return { name: '', address: raw.trim() };
}

/** Retire les préfixes de transfert/réponse (TR:, RE:, FW:, Fwd:), répétés. */
export function stripForwardPrefixes(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const m = s.match(/^(?:TR|RE|FW|FWD)\s?:\s*/i);
    if (!m) return s;
    s = s.slice(m[0].length);
  }
}

// Lignes d'en-tête d'un bloc de transfert Outlook (FR et EN par prudence).
const HEADER_LINE = /^[ \t]*(?:De|Envoyé|À|A|Cc|Objet|From|Sent|To|Subject)\s?:/;

export function unwrapForwards(from: string, subject: string, text: string): EmailEnvelope {
  const lines = text.split(/\r?\n/);
  let lastDe = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^[ \t]*De\s?:\s*\S/.test(lines[i])) lastDe = i;
  }
  if (lastDe === -1) {
    const a = parseAddress(from);
    return { fromName: a.name, fromAddress: a.address, subject: stripForwardPrefixes(subject), body: text };
  }
  const a = parseAddress(lines[lastDe].replace(/^[ \t]*De\s?:\s*/, ''));
  // L'« Objet : » du bloc original est plus fiable que l'en-tête de tête
  // (préfixes TR:, ré-encodages) -> il remplace le sujet si présent.
  let subj = stripForwardPrefixes(subject);
  let i = lastDe + 1;
  while (i < lines.length && (HEADER_LINE.test(lines[i]) || lines[i].trim() === '')) {
    const om = lines[i].match(/^[ \t]*Objet\s?:\s*(.+)$/);
    if (om) subj = stripForwardPrefixes(om[1]);
    i++;
  }
  return { fromName: a.name, fromAddress: a.address, subject: subj, body: lines.slice(i).join('\n') };
}
