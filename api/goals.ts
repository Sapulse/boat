import { route, body } from './_lib/http';
import { prisma } from './_lib/prisma';
import { saveGoals } from './_lib/store';
import type { CommercialGoal } from '../src/data/types';

// PUT /api/goals — enregistrement par lot (saveGoals). Le corps est l'ensemble
// COMPLET des objectifs : upsert des présents, suppression des absents (D10).
export default route({
  PUT: async (req, res) => {
    const saved = await saveGoals(prisma, body<CommercialGoal[]>(req));
    res.json(saved);
  },
});
