import { route, body } from '../_lib/http';
import { prisma } from '../_lib/prisma';
import { createAction } from '../_lib/store';
import type { LeadAction } from '../../src/data/types';

// POST /api/actions — journalise une action (id fourni par le client).
export default route({
  POST: async (req, res) => {
    const created = await createAction(prisma, body<LeadAction>(req));
    res.status(201).json(created);
  },
});
