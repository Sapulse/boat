import { route, body } from '../_lib/http';
import { prisma } from '../_lib/prisma';
import { createCalendarEvent } from '../_lib/store';
import type { CalendarEvent } from '../../src/data/types';

// POST /api/calendar-events — création d'un événement libre (id fourni client).
export default route({
  POST: async (req, res) => {
    const created = await createCalendarEvent(prisma, body<CalendarEvent>(req));
    res.status(201).json(created);
  },
});
