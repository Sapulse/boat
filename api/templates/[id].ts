import { route, body, pathId } from '../_lib/http';
import { prisma } from '../_lib/prisma';
import { updateTemplate, deleteTemplate } from '../_lib/store';
import type { MessageTemplate } from '../../src/data/types';

// PATCH /api/templates/:id — édition. DELETE — suppression (la garde min-1 est
// une règle CLIENT, cf. reducer).
export default route({
  PATCH: async (req, res) => {
    const updated = await updateTemplate(prisma, pathId(req), body<Partial<MessageTemplate>>(req));
    res.json(updated);
  },
  DELETE: async (req, res) => {
    await deleteTemplate(prisma, pathId(req));
    res.status(204).end();
  },
});
