import { route, body, pathId } from '../_lib/http';
import { prisma } from '../_lib/prisma';
import { updateAction, deleteAction } from '../_lib/store';
import type { LeadAction } from '../../src/data/types';

// PATCH /api/actions/:id — édition. DELETE — suppression (confinée aux actions).
export default route({
  PATCH: async (req, res) => {
    const updated = await updateAction(prisma, pathId(req), body<Partial<LeadAction>>(req));
    res.json(updated);
  },
  DELETE: async (req, res) => {
    await deleteAction(prisma, pathId(req));
    res.status(204).end();
  },
});
