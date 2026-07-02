import { route, body } from './_lib/http';
import { prisma } from './_lib/prisma';
import { saveMonthlyStats } from './_lib/store';
import type { MonthlyStat } from '../src/data/types';

// PUT /api/monthly-stats — enregistrement par lot (saveMonthlyStats) : ensemble
// COMPLET, upsert des présents + suppression des absents (D10).
export default route({
  PUT: async (req, res) => {
    const saved = await saveMonthlyStats(prisma, body<MonthlyStat[]>(req));
    res.json(saved);
  },
});
