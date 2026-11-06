import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../lib/auth';
import { verifyScan } from '../services/scan';

export const ticketsRouter = Router();

// Gatekeeper endpoint: the in-browser scanner posts the decoded QR text here.
ticketsRouter.post('/verify-scan', requireRole('organizer', 'admin'), async (req, res) => {
  const body = z.object({
    code: z.string().trim().min(8).max(200),
    eventId: z.string().uuid().optional(),
  }).parse(req.body);
  res.json(await verifyScan(req.user!, body.code, body.eventId));
});
