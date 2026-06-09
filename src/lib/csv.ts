/**
 * Helper unique d'export CSV (source de verite).
 * - BOM UTF-8 (Excel FR detecte l'encodage)
 * - separateur point-virgule
 * - fins de ligne CRLF
 * - chaque champ est echappe (guillemets doubles) pour rester valide meme s'il
 *   contient ; " ou un retour a la ligne.
 */
export function exportCSV(filename: string, headers: string[], rows: string[][]): void {
  const BOM = String.fromCharCode(0xfeff);
  const escape = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
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
