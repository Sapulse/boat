import { route, body } from './_lib/http';
import { prisma } from './_lib/prisma';
import { saveDefaultGoal } from './_lib/store';
import type { DefaultGoal } from '../src/data/types';

// PUT /api/default-goal — objectifs par défaut de l'équipe (singleton id=1, upsert).
export default route({
  PUT: async (req, res) => {
    const saved = await saveDefaultGoal(prisma, body<DefaultGoal>(req));
    res.json(saved);
  },
});
