/**
 * Helper unique d'export CSV (source de verite).
 * - BOM UTF-8 (Excel FR detecte l'encodage)
 * - separateur point-virgule
 * - fins de ligne CRLF
 * - chaque champ est echappe (guillemets doubles) pour rester valide meme s'il
 *   contient ; " ou un retour a la ligne.
 * - neutralisation de l'injection de formule (CSV injection) : un champ debutant
 *   par = + - @ ou par une tabulation / retour chariot est prefixe d'une
 *   apostrophe pour qu'Excel / LibreOffice / Sheets le traitent comme du texte
 *   et non comme une formule (mitigation OWASP). Le prefixe est cosmetique : un
 *   montant negatif "-5000" reste lisible, simplement affiche '-5000.
 */
function escape(v: string): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function exportCSV(filename: string, headers: string[], rows: string[][]): void {
  const BOM = String.fromCharCode(0xfeff);
  const lines = [
    headers.map(escape).join(';'),
    ...rows.map(row => row.map(escape).join(';')),
  ];
  const blob = new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
