import { route, body, pathId } from '../_lib/http';
import { prisma } from '../_lib/prisma';
import { updateCommercial } from '../_lib/store';
import type { Commercial } from '../../src/data/types';

// PATCH /api/commercials/:id — édition ET bascule d'activité (toggle = patch
// `active` calculé côté client). Pas de DELETE (aucune suppression de commercial
// dans le modèle actuel).
export default route({
  PATCH: async (req, res) => {
    const updated = await updateCommercial(prisma, pathId(req), body<Partial<Commercial>>(req));
    res.json(updated);
  },
});
