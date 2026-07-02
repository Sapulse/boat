import { route } from './_lib/http';
import { prisma } from './_lib/prisma';
import { getState } from './_lib/store';

// GET /api/state — hydratation : renvoie l'AppState complet (couvre
// getInitialState du repository). Base vierge (D9) -> collections vides.
export default route({
  GET: async (_req, res) => {
    res.json(await getState(prisma));
  },
});
