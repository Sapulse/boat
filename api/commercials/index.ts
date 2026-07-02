import { route, body } from '../_lib/http';
import { prisma } from '../_lib/prisma';
import { createCommercial } from '../_lib/store';
import type { Commercial } from '../../src/data/types';

// POST /api/commercials — ajout d'un commercial (id fourni par le client).
export default route({
  POST: async (req, res) => {
    const created = await createCommercial(prisma, body<Commercial>(req));
    res.status(201).json(created);
  },
});
