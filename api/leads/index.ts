import { route, body } from '../_lib/http';
import { prisma } from '../_lib/prisma';
import { createLead } from '../_lib/store';
import type { Lead } from '../../src/data/types';

// POST /api/leads — création (l'id est fourni par le client, comme aujourd'hui).
export default route({
  POST: async (req, res) => {
    const created = await createLead(prisma, body<Lead>(req));
    res.status(201).json(created);
  },
});
