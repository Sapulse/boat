import { route, body, pathId } from '../_lib/http';
import { prisma } from '../_lib/prisma';
import { updateCalendarEvent, deleteCalendarEvent } from '../_lib/store';
import type { CalendarEvent } from '../../src/data/types';

// PATCH /api/calendar-events/:id — édition. DELETE — suppression libre.
export default route({
  PATCH: async (req, res) => {
    const updated = await updateCalendarEvent(prisma, pathId(req), body<Partial<CalendarEvent>>(req));
    res.json(updated);
  },
  DELETE: async (req, res) => {
    await deleteCalendarEvent(prisma, pathId(req));
    res.status(204).end();
  },
});
