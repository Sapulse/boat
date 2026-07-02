import { route, body } from '../_lib/http';
import { prisma } from '../_lib/prisma';
import { createTemplate } from '../_lib/store';
import type { MessageTemplate } from '../../src/data/types';

// POST /api/templates — ajout d'un modèle (id fourni par le client).
export default route({
  POST: async (req, res) => {
    const created = await createTemplate(prisma, body<MessageTemplate>(req));
    res.status(201).json(created);
  },
});
