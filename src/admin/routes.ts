import fs from 'fs';
import path from 'path';
import express, { Router, Request, Response, NextFunction } from 'express';
import { DatabaseContext } from '../db/index.js';
import { BillingService } from '../billing/service.js';
import { SchedulingEngine } from '../calendar/scheduler.js';
import { WhatsAppGateway } from '../twilio/client.js';
import { GeminiClient } from '../gemini/agent.js';

import { Appointment } from '../types/index.js';

export interface AdminRouterOptions {
  db: DatabaseContext;
  billing: BillingService;
  adminSecret: string;
  scheduler?: SchedulingEngine;
  gateway?: WhatsAppGateway;
  geminiClient?: GeminiClient;
}

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router();
  const { db, billing, adminSecret, scheduler, gateway, geminiClient } = options;

  // Simple auth middleware: checks Authorization header or query param
  const requireAdminAuth = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const queryKey = req.query.key as string;
    const token = authHeader ? authHeader.replace('Bearer ', '') : queryKey;

    if (!token || token !== adminSecret) {
      res.status(401).json({ error: 'Unauthorized: Invalid or missing admin credentials' });
      return;
    }
    next();
  };

  // Helper: notify affected patients and mark appointment rescheduled when shifts change
  const notifyAndRescheduleConflicts = async (
    conflicts: Appointment[],
    reason: string
  ): Promise<Array<{ appointmentId: string; customerName: string; phone: string; message: string }>> => {
    const notifiedList: Array<{ appointmentId: string; customerName: string; phone: string; message: string }> = [];
    const seenApptIds = new Set<string>();

    for (const appt of conflicts) {
      if (seenApptIds.has(appt.id)) continue;
      seenApptIds.add(appt.id);

      const customer = db.customers.findById(appt.customer_id);
      if (!customer || customer.opted_out) continue;

      // Find 2-3 candidate open slots across the next 14 days
      let suggestedSlots: string[] = [];
      if (scheduler) {
        try {
          const apptDateStr = new Date(appt.start_time).toISOString().split('T')[0];
          const rangeSlots = await scheduler.getAvailableSlotsAcrossRange(apptDateStr, 14, appt.visit_type, 3);
          suggestedSlots = rangeSlots.map((r) => `${r.date} at ${r.available_slots.slice(0, 2).join(' or ')}`);
        } catch {
          // fallback
        }
      }

      let outreachMessage = '';
      if (geminiClient && geminiClient.generateRescheduleOutreach) {
        try {
          outreachMessage = await geminiClient.generateRescheduleOutreach({
            customerName: customer.name || 'Patient',
            appointment: {
              service: appt.service,
              start_time: appt.start_time,
              visit_type: appt.visit_type,
              address: appt.address,
            },
            doctorPrompt: reason,
            suggestedSlots,
          });
        } catch {
          // fallback
        }
      }

      if (!outreachMessage) {
        const slotsText = suggestedSlots.length > 0
          ? ` Suggested alternative times: ${suggestedSlots.join('; ')}.`
          : ' Please reply with your preferred day and time!';
        outreachMessage = `Hello ${customer.name || 'Patient'}, due to an update in our clinic schedule (${reason}), we need to reschedule your ${appt.service} appointment originally scheduled for ${new Date(appt.start_time).toLocaleString()}.${slotsText}`;
      }

      // Send WhatsApp message if gateway is available
      if (gateway) {
        try {
          const sendRes = await gateway.sendMessage(customer.phone, outreachMessage, customer.id);
          const conv = db.conversations.getOrCreateActive(customer.id);
          db.messages.create(conv.id, 'outbound', outreachMessage, sendRes.messageSid, 'sent');
        } catch (err) {
          console.error(`Failed to send proactive reschedule WhatsApp to ${customer.phone}:`, err);
        }
      }

      // Mark appointment as 'rescheduled' and update notes
      const updatedNotes = [
        appt.notes || '',
        `[Auto Schedule Conflict Outreach Sent at ${new Date().toISOString()} (${reason})]`,
      ].filter(Boolean).join('\n');

      db.appointments.updateStatus(appt.id, 'rescheduled');
      db.appDb.db.prepare('UPDATE appointments SET notes = ? WHERE id = ?').run(updatedNotes, appt.id);

      // Create admin alert record
      db.alerts.create({
        type: 'schedule_conflict',
        title: `Auto-Rescheduled: ${customer.name || customer.phone}`,
        details: `Auto-contacted ${customer.name || customer.phone} via WhatsApp to reschedule ${appt.service} on ${appt.start_time} (${reason}).`,
        customer_id: customer.id,
      });

      notifiedList.push({
        appointmentId: appt.id,
        customerName: customer.name || 'Patient',
        phone: customer.phone,
        message: outreachMessage,
      });
    }

    return notifiedList;
  };

  // --- API Endpoints ---

  // 1. Availability Rules & Overrides
  router.get('/api/availability', requireAdminAuth, (req: Request, res: Response) => {
    const rules = db.availability.getAllRules();
    const overrides = db.availability.getAllOverrides();
    res.json({ rules, overrides });
  });

  router.post('/api/availability/rules', requireAdminAuth, async (req: Request, res: Response) => {
    const { day_of_week, start_time, end_time, is_active, shifts } = req.body;
    if (day_of_week === undefined || !start_time || !end_time) {
      res.status(400).json({ error: 'Missing day_of_week, start_time, or end_time' });
      return;
    }

    // Detect conflicts with upcoming appointments
    const newShiftsList = Array.isArray(shifts) && shifts.length > 0
      ? shifts
      : [{ start_time, end_time }];
    const conflicts = scheduler
      ? scheduler.getConflictingAppointmentsForWeeklyChange(Number(day_of_week), newShiftsList, Boolean(is_active))
      : [];

    db.availability.updateRule(Number(day_of_week), start_time, end_time, Boolean(is_active), shifts);

    const notifiedPatients = await notifyAndRescheduleConflicts(
      conflicts,
      Boolean(is_active) ? 'Weekly shift hours updated' : 'Clinic closed on this weekday'
    );

    res.json({
      success: true,
      rules: db.availability.getAllRules(),
      affectedCount: conflicts.length,
      notifiedPatients,
    });
  });

  router.post('/api/availability/rules/batch', requireAdminAuth, async (req: Request, res: Response) => {
    const { rules } = req.body;
    if (!Array.isArray(rules)) {
      res.status(400).json({ error: 'Rules must be an array' });
      return;
    }

    // Detect conflicts across all updated rules in batch
    const allConflicts: Appointment[] = [];
    if (scheduler) {
      for (const rule of rules) {
        const shiftsList = Array.isArray(rule.shifts) && rule.shifts.length > 0
          ? rule.shifts
          : [{ start_time: rule.start_time, end_time: rule.end_time }];
        const ruleConflicts = scheduler.getConflictingAppointmentsForWeeklyChange(
          Number(rule.day_of_week),
          shiftsList,
          Boolean(rule.is_active)
        );
        allConflicts.push(...ruleConflicts);
      }
    }

    db.availability.updateRulesBatch(rules);

    const notifiedPatients = await notifyAndRescheduleConflicts(
      allConflicts,
      'Weekly working schedule adjusted'
    );

    res.json({
      success: true,
      rules: db.availability.getAllRules(),
      affectedCount: notifiedPatients.length,
      notifiedPatients,
    });
  });

  router.post('/api/availability/overrides', requireAdminAuth, async (req: Request, res: Response) => {
    const { date, is_unavailable, start_time, end_time, reason, shifts } = req.body;
    if (!date) {
      res.status(400).json({ error: 'Date is required for an override' });
      return;
    }
    const override = db.availability.setOverride({
      date,
      is_unavailable: is_unavailable !== undefined ? Boolean(is_unavailable) : true,
      start_time,
      end_time,
      reason,
      shifts,
    });

    // Check for conflicting appointments on this specific date
    const conflicts = scheduler
      ? scheduler.getConflictingAppointmentsForDate(date)
      : [];

    const notifiedPatients = await notifyAndRescheduleConflicts(
      conflicts,
      reason || (is_unavailable ? 'Doctor unavailable / clinic closed on this date' : 'Working hours adjusted on this date')
    );

    res.json({
      success: true,
      override,
      affectedCount: conflicts.length,
      notifiedPatients,
    });
  });

  router.post('/api/availability/overrides/batch', requireAdminAuth, async (req: Request, res: Response) => {
    const { overrides } = req.body;
    if (!Array.isArray(overrides)) {
      res.status(400).json({ error: 'Overrides must be an array' });
      return;
    }

    const allConflicts: Appointment[] = [];
    const savedOverrides = [];

    for (const ov of overrides) {
      if (!ov.date) continue;
      const saved = db.availability.setOverride({
        date: ov.date,
        is_unavailable: ov.is_unavailable !== undefined ? Boolean(ov.is_unavailable) : true,
        start_time: ov.start_time,
        end_time: ov.end_time,
        reason: ov.reason,
        shifts: ov.shifts,
      });
      savedOverrides.push(saved);

      if (scheduler) {
        const conflicts = scheduler.getConflictingAppointmentsForDate(ov.date);
        allConflicts.push(...conflicts);
      }
    }

    const notifiedPatients = await notifyAndRescheduleConflicts(
      allConflicts,
      'Specific week schedule adjustment'
    );

    res.json({
      success: true,
      overrides: db.availability.getAllOverrides(),
      affectedCount: notifiedPatients.length,
      notifiedPatients,
    });
  });

  router.delete('/api/availability/overrides/range', requireAdminAuth, (req: Request, res: Response) => {
    const { start_date, end_date } = req.body;
    if (!start_date || !end_date) {
      res.status(400).json({ error: 'start_date and end_date are required' });
      return;
    }
    db.availability.deleteOverridesInRange(String(start_date), String(end_date));
    res.json({
      success: true,
      overrides: db.availability.getAllOverrides(),
    });
  });

  router.delete('/api/availability/overrides/:id', requireAdminAuth, (req: Request, res: Response) => {
    db.availability.deleteOverride(String(req.params.id));
    res.json({ success: true, overrides: db.availability.getAllOverrides() });
  });

  // Settings: Commute Buffer & Global Doctor Preferences
  router.get('/api/settings', requireAdminAuth, (req: Request, res: Response) => {
    const bufferMinutes = parseInt(db.settings.get('home_visit_buffer_minutes', '30'), 10) || 30;
    res.json({
      home_visit_buffer_minutes: bufferMinutes,
      all: db.settings.getAll(),
    });
  });

  router.post('/api/settings', requireAdminAuth, (req: Request, res: Response) => {
    const { home_visit_buffer_minutes } = req.body;
    if (home_visit_buffer_minutes !== undefined) {
      const minutes = Math.max(0, parseInt(String(home_visit_buffer_minutes), 10) || 0);
      db.settings.set('home_visit_buffer_minutes', String(minutes));
    }
    const bufferMinutes = parseInt(db.settings.get('home_visit_buffer_minutes', '30'), 10) || 30;
    res.json({
      success: true,
      home_visit_buffer_minutes: bufferMinutes,
    });
  });

  // 2. Appointments
  router.get('/api/appointments', requireAdminAuth, (req: Request, res: Response) => {
    const appointments = db.appointments.listUpcoming(100);
    const enriched = appointments.map((appt) => {
      let conversationHistory: Array<{ direction: string; body: string; created_at: string }> = [];
      try {
        const conv = db.conversations.getOrCreateActive(appt.customer_id);
        const msgs = db.messages.getRecentMessages(conv.id, 10);
        conversationHistory = msgs.map((m) => ({
          direction: m.direction,
          body: m.body,
          created_at: m.created_at,
        }));
      } catch {
        // ignore
      }
      return {
        ...appt,
        conversation_history: conversationHistory,
      };
    });
    res.json({ appointments: enriched });
  });

  router.post('/api/appointments/:id/cancel', requireAdminAuth, async (req: Request, res: Response) => {
    const appointmentId = String(req.params.id);
    const { reason } = req.body || {};

    const appt = db.appointments.findById(appointmentId);
    if (!appt) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }

    try {
      let cancelled: Appointment;
      if (scheduler) {
        cancelled = await scheduler.cancelAppointment(appointmentId, reason || 'Cancelled by clinic admin');
      } else {
        db.appointments.updateStatus(appointmentId, 'cancelled');
        cancelled = db.appointments.findById(appointmentId)!;
      }

      // Create admin alert
      db.alerts.create({
        type: 'schedule_conflict',
        title: `Appointment Cancelled: ${appt.service}`,
        details: `Cancelled appointment on ${appt.start_time}. Reason: ${reason || 'Admin action'}`,
        customer_id: appt.customer_id,
      });

      res.json({ success: true, appointment: cancelled });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || String(err) });
    }
  });

  router.post('/api/appointments/:id/complete', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const result = await billing.completeAppointmentAndBill(String(req.params.id));
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || String(err) });
    }
  });

  // Doctor prompts AI to reschedule with client over WhatsApp
  router.post('/api/appointments/:id/request-reschedule', requireAdminAuth, async (req: Request, res: Response) => {
    const appointmentId = String(req.params.id);
    const { doctorPrompt, proposedDate, proposedTime, language } = req.body;

    const appt = db.appointments.findById(appointmentId);
    if (!appt) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }

    const customer = db.customers.findById(appt.customer_id);
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    if (customer.opted_out) {
      res.status(400).json({ error: 'Customer has opted out of WhatsApp messages' });
      return;
    }

    if (!gateway) {
      res.status(500).json({ error: 'WhatsApp gateway not configured' });
      return;
    }

    // Get 2-3 upcoming candidate slots using scheduler if doctor didn't specify exact date & time
    let suggestedSlots: string[] = [];
    if (!proposedDate || !proposedTime) {
      if (scheduler) {
        try {
          const apptDate = new Date(appt.start_time);
          for (let i = 1; i <= 4; i++) {
            const nextDay = new Date(apptDate.getTime() + i * 24 * 60 * 60 * 1000);
            const nextDayStr = nextDay.toISOString().split('T')[0];
            const openSlots = await scheduler.getAvailableSlots(nextDayStr, appt.visit_type);
            if (openSlots.length > 0) {
              suggestedSlots.push(`${nextDayStr} at ${openSlots.slice(0, 2).join(' or ')}`);
            }
            if (suggestedSlots.length >= 3) break;
          }
        } catch {
          // Fallback gracefully
        }
      }
    }

    // Generate tailored message via Gemini AI
    let outreachMessage = '';
    if (geminiClient && geminiClient.generateRescheduleOutreach) {
      outreachMessage = await geminiClient.generateRescheduleOutreach({
        customerName: customer.name || 'Patient',
        appointment: {
          service: appt.service,
          start_time: appt.start_time,
          visit_type: appt.visit_type,
          address: appt.address,
        },
        doctorPrompt,
        proposedDate,
        proposedTime,
        suggestedSlots,
        language,
      });
    } else {
      const specificText = (proposedDate && proposedTime)
        ? ` We would like to move your visit to ${proposedDate} at ${proposedTime}. Does this time work for you?`
        : (suggestedSlots.length > 0 ? ` Suggested open times: ${suggestedSlots.join('; ')}. Please reply with your preferred time!` : ' Please reply with your preferred day and time!');
      const reasonText = doctorPrompt ? ` (${doctorPrompt})` : '';
      outreachMessage = `Hello ${customer.name || 'Patient'}, we need to reschedule your ${appt.service} appointment originally scheduled for ${new Date(appt.start_time).toLocaleString()}${reasonText}.${specificText}`;
    }

    // Dispatch via WhatsApp Gateway
    const sendRes = await gateway.sendMessage(customer.phone, outreachMessage, customer.id);
    const conv = db.conversations.getOrCreateActive(customer.id);
    db.messages.create(conv.id, 'outbound', outreachMessage, sendRes.messageSid, 'sent');

    // Update appointment status and notes
    const logDetails = proposedDate && proposedTime ? `proposing ${proposedDate} at ${proposedTime}` : `prompt: "${doctorPrompt || 'flexible slots'}"`;
    const updatedNotes = [
      appt.notes || '',
      `[Doctor AI Reschedule Sent at ${new Date().toISOString()} (${logDetails})]`,
    ].filter(Boolean).join('\n');

    db.appointments.updateStatus(appt.id, 'rescheduled');
    db.appDb.db.prepare('UPDATE appointments SET notes = ? WHERE id = ?').run(updatedNotes, appt.id);

    res.json({
      success: true,
      messageSent: outreachMessage,
      suggestedSlots,
      appointment: db.appointments.findById(appt.id),
    });
  });

  // Doctor dispatches direct quick automated message to patient on WhatsApp
  router.post('/api/appointments/:id/send-message', requireAdminAuth, async (req: Request, res: Response) => {
    const appointmentId = String(req.params.id);
    const { messageText } = req.body;

    if (!messageText || !String(messageText).trim()) {
      res.status(400).json({ error: 'Message text is required' });
      return;
    }

    const appt = db.appointments.findById(appointmentId);
    if (!appt) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }

    const customer = db.customers.findById(appt.customer_id);
    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    if (customer.opted_out) {
      res.status(400).json({ error: 'Customer has opted out of WhatsApp messages' });
      return;
    }

    if (!gateway) {
      res.status(500).json({ error: 'WhatsApp gateway not configured' });
      return;
    }

    const trimmed = String(messageText).trim();
    const sendRes = await gateway.sendMessage(customer.phone, trimmed, customer.id);
    const conv = db.conversations.getOrCreateActive(customer.id);
    db.messages.create(conv.id, 'outbound', trimmed, sendRes.messageSid, 'sent');

    res.json({
      success: true,
      messageSid: sendRes.messageSid,
      sentText: trimmed,
    });
  });

  // 3. Invoices
  router.get('/api/invoices', requireAdminAuth, (req: Request, res: Response) => {
    const invoices = db.invoices.listAll(50);
    res.json({ invoices });
  });

  router.post('/api/invoices/:id/pay', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const invoice = await billing.markInvoicePaid(String(req.params.id));
      res.json({ success: true, invoice });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || String(err) });
    }
  });

  // 4. Alerts
  router.get('/api/alerts', requireAdminAuth, (req: Request, res: Response) => {
    const alerts = db.alerts.listAll(50);
    res.json({ alerts });
  });

  router.post('/api/alerts/:id/resolve', requireAdminAuth, (req: Request, res: Response) => {
    db.alerts.resolve(String(req.params.id));
    res.json({ success: true });
  });

  // 5. Admin Dashboard Web UI - Microsoft Teams Calendar Experience (React App)
  router.use(express.static(path.resolve(process.cwd(), 'public')));

  router.get('/dashboard', (req: Request, res: Response) => {
    const key = (req.query.key as string) || '';
    const indexPath = path.resolve(process.cwd(), 'public', 'index.html');
    if (!fs.existsSync(indexPath)) {
      res.status(500).send('React frontend bundle not found. Please run "node client/build.js".');
      return;
    }
    let html = fs.readFileSync(indexPath, 'utf-8');
    // Inject admin key so React app can immediately authenticate API calls
    const keyScript = `<script>window.__ADMIN_KEY__ = ${JSON.stringify(key)};</script>`;
    html = html.replace('</head>', `  ${keyScript}\n</head>`);
    res.type('html').send(html);
  });

  return router;
}
