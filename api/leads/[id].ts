import { route, body, pathId } from '../_lib/http';
import { prisma } from '../_lib/prisma';
import { updateLead, deleteLead } from '../_lib/store';
import type { Lead } from '../../src/data/types';

// PATCH /api/leads/:id — mise à jour partielle. DELETE — supprime (cascade actions).
export default route({
  PATCH: async (req, res) => {
    const updated = await updateLead(prisma, pathId(req), body<Partial<Lead>>(req));
    res.json(updated);
  },
  DELETE: async (req, res) => {
    await deleteLead(prisma, pathId(req));
    res.status(204).end();
  },
});
