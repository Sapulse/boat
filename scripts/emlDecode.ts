// Décodeur .eml MINIMAL, dev-only (Node), SANS dépendance : sert le harnais
// d'extraction (harness-parse-email.ts) et le futur générateur de fixtures.
// En production ce code n'existe pas : Microsoft Graph livre from/subject/body
// déjà décodés. Couvre ce que contiennent les .eml de l'échantillon :
// multipart/alternative, quoted-printable, base64, charsets utf-8 / latin1,
// en-têtes RFC 2047. Pas plus.

export interface DecodedEml {
  from: string;
  subject: string;
  date: string;
  text: string; // partie text/plain (vide si absente)
  html: string; // partie text/html (vide si absente)
}

function decodeQP(s: string): Buffer {
  const cleaned = s.replace(/=\r?\n/g, ''); // soft line breaks
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
      bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(cleaned.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}

function charsetOf(ct: string): string {
  const cs = ct.match(/charset="?([^";]+)"?/i)?.[1] ?? 'utf-8';
  return /1252|8859|latin/i.test(cs) ? 'latin1' : 'utf-8';
}

function decodeBody(raw: string, cte: string, charset: string): string {
  let buf: Buffer;
  if (/base64/i.test(cte)) buf = Buffer.from(raw.replace(/\s+/g, ''), 'base64');
  else if (/quoted-printable/i.test(cte)) buf = decodeQP(raw);
  else buf = Buffer.from(raw, 'latin1');
  return new TextDecoder(charset).decode(buf);
}

/** En-têtes RFC 2047 (=?utf-8?B?…?=). Les mots encodés ADJACENTS sont joints
 *  sans l'espace intermédiaire (règle RFC — sinon « à propos » devient
 *  « à propo s » quand le sujet est découpé en plein mot). */
function decodeWords(s: string): string {
  return s
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, data) => {
      const bytes = /b/i.test(enc) ? Buffer.from(data, 'base64') : decodeQP(data.replace(/_/g, ' '));
      return new TextDecoder(/1252|8859|latin/i.test(cs) ? 'latin1' : 'utf-8').decode(bytes);
    });
}

interface Part { headers: Record<string, string>; body: string }

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' '); // dépliage RFC 5322
  for (const line of unfolded.split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  return headers;
}

function splitMessage(raw: string): Part {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m || m.index === undefined) return { headers: parseHeaders(raw), body: '' };
  return { headers: parseHeaders(raw.slice(0, m.index)), body: raw.slice(m.index + m[0].length) };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectText(part: Part, out: { plain: string[]; html: string[] }): void {
  const ct = part.headers['content-type'] ?? 'text/plain';
  const cte = part.headers['content-transfer-encoding'] ?? '7bit';
  const boundary = ct.match(/boundary="?([^";]+)"?/i)?.[1];
  if (/multipart/i.test(ct) && boundary) {
    for (const piece of part.body.split(new RegExp(`--${escapeRe(boundary)}(?:--)?\\s*\\r?\\n?`))) {
      if (piece.trim()) collectText(splitMessage(piece), out);
    }
  } else if (/text\/plain/i.test(ct)) {
    out.plain.push(decodeBody(part.body, cte, charsetOf(ct)));
  } else if (/text\/html/i.test(ct)) {
    out.html.push(decodeBody(part.body, cte, charsetOf(ct)));
  }
}

/** Décode un .eml brut (contenu du fichier lu en latin1) vers ses champs utiles. */
export function decodeEml(raw: string): DecodedEml {
  const msg = splitMessage(raw);
  const out = { plain: [] as string[], html: [] as string[] };
  collectText(msg, out);
  return {
    from: decodeWords(msg.headers['from'] ?? ''),
    subject: decodeWords(msg.headers['subject'] ?? ''),
    date: msg.headers['date'] ?? '',
    text: out.plain.join('\n'),
    html: out.html.join('\n'),
  };
}
