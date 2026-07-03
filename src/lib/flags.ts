// Feature flag de bascule vers l'API (chantier migration, Lot 5). CONSTANTE DE
// BUILD : Vite inline `import.meta.env.VITE_USE_API` à la compilation, donc
// `USE_API` devient un booléen littéral dans chaque module qui l'importe -> le
// code sous `USE_API && …` est TREE-SHAKÉ quand le flag est off (zéro impact
// pour les commerciaux sur localStorage). Partagé (AppContext + Header) pour que
// les DEUX bénéficient de l'élimination.
export const USE_API = import.meta.env.VITE_USE_API === 'true';
