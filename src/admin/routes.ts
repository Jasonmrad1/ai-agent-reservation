import { beirutDateTimeToUtc, getBeirutTimeInfo, getBeirutTodayStr } from '../utils/timezone.js';
import fs from 'fs';
import { createAdminAuth, AdminAuth } from '../security/admin-auth.js';
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
  auth?: AdminAuth;
  calendarRedirectUri?: string;
  scheduler?: SchedulingEngine;
  gateway?: WhatsAppGateway;
  geminiClient?: GeminiClient;
}

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router();
  const { db, billing, adminSecret, scheduler, gateway, geminiClient } = options;

  const auth = options.auth || createAdminAuth(db, adminSecret, { legacyQuery: process.env.NODE_ENV === 'test' });
  const requireAdminAuth = auth.middleware;
  router.get('/login', (_req, res) => res.type('html').send('<!doctype html><meta name="viewport" content="width=device-width"><title>Clinic login</title><form method="post" action="/admin/login"><label>Administrator password <input type="password" name="secret" required autocomplete="current-password"></label><button>Sign in</button></form>'));
  router.post('/login', auth.login);
  router.get('/api/session', requireAdminAuth, (_req, res) => res.json({ csrfToken: res.locals.csrfToken || null }));
  router.post('/logout', requireAdminAuth, (req, res) => {
    const active = auth.session(req);
    if (active) db.appDb.db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(active.token_hash);
    res.clearCookie('clinic_session', { path: '/' }); res.json({ success: true });
  });

  router.get('/api/conversations', requireAdminAuth, (_req,res)=>{
    res.json({conversations:db.appDb.db.prepare("SELECT conversations.*, customers.phone, customers.name FROM conversations JOIN customers ON customers.id=conversations.customer_id WHERE conversations.status != 'closed' ORDER BY conversations.updated_at DESC LIMIT 200").all()});
  });
  router.post('/api/conversations/:id/control',requireAdminAuth,(req,res)=>{
    const status=req.body?.action==='takeover' ? 'doctor_active' : req.body?.action==='resume' ? 'active' : null;
    const conv=db.appDb.db.prepare('SELECT id FROM conversations WHERE id=?').get(String(req.params.id));
    if (!conv) {res.status(404).json({error:'Conversation not found'});return;}
    if (!status) {res.status(400).json({error:'Choose takeover or resume'});return;}
    db.conversations.updateStatus(String(req.params.id),status);res.json({success:true,status});
  });

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
      db.alerts.create({type:'schedule_conflict',title:'Appointment needs a new agreed time',details:`Appointment ${appt.id} at ${appt.start_time} conflicts with ${reason}. The appointment has not been moved.`,customer_id:appt.customer_id});
      if (!customer || customer.opted_out) continue;

      // Find 2-3 candidate open slots across the next 14 days
      let suggestedSlots: string[] = [];
      if (scheduler) {
        try {
          const apptDateStr = getBeirutTimeInfo(new Date(appt.start_time)).dateStr;
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
        outreachMessage = `Hello ${customer.name || 'Patient'}, due to an update in our clinic schedule (${reason}), we need to reschedule your ${appt.service} appointment originally scheduled for ${new Date(appt.start_time).toLocaleString('en-US', { timeZone: 'Asia/Beirut' })}.${slotsText}`;
      }

      // Send WhatsApp message if gateway is available
      let notificationAccepted=false;
      if (gateway) {
        try {
          const sendRes = await gateway.sendMessage(customer.phone, outreachMessage, customer.id,{category:'schedule_change',variables:{'1':new Date(appt.start_time).toLocaleString('en-US',{timeZone:'Asia/Beirut'})}});
          const conv = db.conversations.getOrCreateActive(customer.id);
          db.messages.create(conv.id, 'outbound', outreachMessage, sendRes.messageSid, sendRes.status);
          notificationAccepted=true;
        } catch (err) {
          console.error(`Failed to send proactive reschedule WhatsApp to ${customer.phone}:`, err);
        }
      }

      // Record the outreach separately from the actual appointment time and status
      const updatedNotes = [
        appt.notes || '',
        `[Schedule Conflict Outreach ${notificationAccepted ? 'accepted' : 'pending/failed'} at ${new Date().toISOString()} (${reason})]`,
      ].filter(Boolean).join('\n');

      db.appDb.db.prepare('UPDATE appointments SET notes = ? WHERE id = ?').run(updatedNotes, appt.id);

      // Create admin alert record
      db.alerts.create({
        type: 'schedule_conflict',
        title: `Reschedule Needed: ${customer.name || customer.phone}`,
        details: `Auto-contacted ${customer.name || customer.phone} via WhatsApp to reschedule ${appt.service} on ${appt.start_time} (${reason}).`,
        customer_id: customer.id,
      });

      if (notificationAccepted) notifiedList.push({
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
    const todayStr = getBeirutTodayStr();

    for (const ov of overrides) {
      if (!ov.date || ov.date < todayStr) continue;
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
    const weekDate = req.query.week as string;
    let weekBufferMinutes: number | undefined;
    if (weekDate) {
      const weekVal = parseInt(db.settings.get(`home_visit_buffer_minutes_week_${weekDate}`, ''), 10);
      if (!isNaN(weekVal) && weekVal >= 0) {
        weekBufferMinutes = weekVal;
      }
    }
    const defaultBufferMinutes = Number(db.settings.get('home_visit_buffer_minutes', '30'));
    res.json({
      home_visit_buffer_minutes: weekBufferMinutes !== undefined ? weekBufferMinutes : defaultBufferMinutes,
      default_buffer_minutes: defaultBufferMinutes,
      all: Object.fromEntries(Object.entries(db.settings.getAll()).filter(([key]) => !/token|secret|password|credential/i.test(key))),
    });
  });

  router.post('/api/settings', requireAdminAuth, (req: Request, res: Response) => {
    const { home_visit_buffer_minutes, week_date, set_as_default } = req.body;
    if (home_visit_buffer_minutes !== undefined) {
      const minutes = Number(home_visit_buffer_minutes);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 480 || String(home_visit_buffer_minutes).trim()==='') {res.status(400).json({error:'Travel buffer must be an integer between 0 and 480'});return;}
      if(week_date && (!/^\d{4}-\d{2}-\d{2}$/.test(week_date) || !Number.isFinite(Date.parse(week_date)))) {res.status(400).json({error:'Invalid week date'});return;}
      if (week_date && !set_as_default) {
        db.settings.set(`home_visit_buffer_minutes_week_${week_date}`, String(minutes));
      } else {
        db.settings.set('home_visit_buffer_minutes', String(minutes));
        if (week_date) {
          db.settings.set(`home_visit_buffer_minutes_week_${week_date}`, String(minutes));
        }
      }
    }
    const bufferMinutes = Number(db.settings.get('home_visit_buffer_minutes', '30'));
    res.json({
      success: true,
      home_visit_buffer_minutes: bufferMinutes,
    });
  });

  // Google Calendar Integration Endpoints
  router.get('/auth/google', requireAdminAuth, async (req: Request, res: Response) => {
    const state = auth.oauthState(req);
    if (!state) { res.status(401).send('Sign in before connecting Google Calendar'); return; }
    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    const redirectUri = options.calendarRedirectUri || process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${req.protocol}://${req.get('host')}/admin/oauth2callback`;

    if (!clientId || !clientSecret) {
      res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Google Calendar Configuration Required</title></head>
        <body style="background:#000;color:#fff;font-family:-apple-system,sans-serif;padding:40px;text-align:center;">
          <h2 style="color:#fb7185;">Google Calendar Credentials Missing</h2>
          <p style="color:#94a3b8;max-width:500px;margin:16px auto;line-height:1.6;">
            Please add <code>GOOGLE_CALENDAR_CLIENT_ID</code> and <code>GOOGLE_CALENDAR_CLIENT_SECRET</code> to your <code>.env</code> file.
          </p>
          <a href="/admin/dashboard" style="display:inline-block;margin-top:20px;padding:10px 20px;background:#00f59b;color:#000;text-decoration:none;border-radius:8px;font-weight:700;">&larr; Back to Dashboard</a>
        </body>
        </html>
      `);
      return;
    }

    try {
      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/calendar.readonly',
        ],
        state,
      });

      res.redirect(authUrl);
    } catch (err: any) {
      res.status(500).json({ error: 'Could not start Google Calendar authorization' });
    }
  });

  router.get('/oauth2callback', async (req: Request, res: Response) => {
    const code = req.query.code as string;
    if (!auth.consumeOAuthState(req)) { res.status(403).send('Invalid or expired OAuth state'); return; }

    if (!code) {
      res.status(400).send('Missing authorization code from Google');
      return;
    }

    try {
      const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
      const redirectUri = options.calendarRedirectUri || process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${req.protocol}://${req.get('host')}/admin/oauth2callback`;

      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      const { tokens } = await oauth2Client.getToken(code);

      if (tokens.refresh_token) {
        db.settings.set('google_calendar_refresh_token', tokens.refresh_token);
        db.settings.set('google_calendar_connected_at', new Date().toISOString());
      }

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Google Calendar Connected</title>
          <meta http-equiv="refresh" content="2;url=/admin/dashboard?google_connected=1">
          <style>
            body { background: #000; color: #fff; font-family: -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .badge { background: rgba(0, 245, 155, 0.15); color: #00f59b; border: 1px solid #00f59b; padding: 10px 20px; border-radius: 24px; font-weight: 700; font-size: 16px; margin-bottom: 12px; }
          </style>
        </head>
        <body>
          <div class="badge">✓ Google Calendar Connected Successfully</div>
          <p style="color: #94a3b8;">Redirecting back to your doctor dashboard...</p>
        </body>
        </html>
      `);
    } catch (err: any) {
      res.status(500).json({ error: 'Could not connect Google Calendar' });
    }
  });

  router.get('/api/google-calendar/status', requireAdminAuth, (req: Request, res: Response) => {
    const refreshToken = db.settings.get('google_calendar_refresh_token', '');
    const connectedAt = db.settings.get('google_calendar_connected_at', '');
    const hasConfig = Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET);
    res.json({
      configured: hasConfig,
      connected: Boolean(refreshToken),
      connectedAt: connectedAt || null,
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
    });
  });

  router.post('/api/google-calendar/disconnect', requireAdminAuth, (req: Request, res: Response) => {
    db.settings.delete('google_calendar_refresh_token');
    db.settings.delete('google_calendar_connected_at');
    res.json({ success: true, connected: false });
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

  // Direct edit appointment details (notes, address, service, visit_type)
  router.patch('/api/appointments/:id', requireAdminAuth, async (req: Request, res: Response) => {
    const appointmentId = String(req.params.id);
    const appt = db.appointments.findById(appointmentId);
    if (!appt) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }

    const { service, visit_type, address, notes, start_time, end_time } = req.body || {};
    try {
      if (!scheduler) throw new Error('Scheduler is required for appointment edits');
      if (service!==undefined && (typeof service!=='string' || !service.trim() || service.length>200)) throw new Error('Invalid service');
      if (notes!==undefined && notes!==null && (typeof notes!=='string' || notes.length>5000)) throw new Error('Invalid notes');
      const updated=await scheduler.rescheduleAppointment({appointmentId,newStartTime:start_time ?? appt.start_time,newEndTime:end_time ?? appt.end_time,visitType:visit_type ?? appt.visit_type,address:address ?? appt.address,service,notes});
      res.json({success:true,appointment:updated});
    } catch(error:any) {res.status(400).json({error:error.message || 'Appointment edit failed'});}

  });

  // Doctor manually creates an appointment (walk-in, phone call, in-person)
  router.post('/api/appointments/manual', requireAdminAuth, async (req: Request, res: Response) => {
    const {
      phone,
      name,
      date,
      time,
      visit_type,
      address,
      service,
      price,
      notes,
      override,
      send_whatsapp,
    } = req.body;

    if (!phone || !date || !time) {
      res.status(400).json({ error: 'Missing required fields: phone, date, and time are required.' });
      return;
    }

    const cleanVisitType = visit_type === 'home_visit' ? 'home_visit' : 'in_office';
    if (cleanVisitType === 'home_visit' && (!address || !String(address).trim())) {
      res.status(400).json({ error: 'Address is required for home visits.' });
      return;
    }

    let cleanPhone = String(phone).trim();
    if (!cleanPhone.startsWith('whatsapp:') && !cleanPhone.startsWith('+')) {
      cleanPhone = cleanPhone.startsWith('961') ? `+${cleanPhone}` : `+961${cleanPhone.replace(/^0+/, '')}`;
    }

    try {
      // Find or create customer
      const customer = db.customers.findOrCreate(cleanPhone, name || undefined);

      const startTime = beirutDateTimeToUtc(date, time);
      if (isNaN(startTime.getTime())) {
        res.status(400).json({ error: 'Invalid date or time format.' });
        return;
      }
      const durationMins = req.body.duration_minutes ? Number(req.body.duration_minutes) : 60;
      const endTime = new Date(startTime.getTime() + durationMins * 60 * 1000);

      const apptService = service || 'General Consultation';
      const apptPrice = price !== undefined && !isNaN(Number(price)) ? Number(price) : 100;

      let appt: Appointment;
      if (scheduler) {
        appt = await scheduler.bookAppointment({
          customerId: customer.id,
          customerPhone: customer.phone,
          customerName: name || customer.name,
          visitType: cleanVisitType,
          address: cleanVisitType === 'home_visit' ? String(address).trim() : null,
          service: apptService,
          price: apptPrice,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          notes: notes ? String(notes).trim() : null,
          allowOverride: Boolean(override),
        });
      } else {
        appt = db.appointments.create({
          customer_id: customer.id,
          visit_type: cleanVisitType,
          address: cleanVisitType === 'home_visit' ? String(address).trim() : null,
          service: apptService,
          price: apptPrice,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          status: 'booked',
          notes: notes ? String(notes).trim() : null,
        });
      }

      // Optionally notify patient via WhatsApp
      let whatsappSent = false;
      if (send_whatsapp && gateway && !customer.opted_out) {
        try {
          const visitDetails = cleanVisitType === 'home_visit'
            ? `Home Visit at ${String(address).trim()}`
            : 'In-Office Consultation at the clinic';
          const confirmMsg = `Hello ${name || customer.name || 'there'}! Your appointment for ${apptService} (${visitDetails}) has been scheduled for ${date} at ${time}. We look forward to seeing you!`;
          const sendRes = await gateway.sendMessage(customer.phone, confirmMsg, customer.id);
          const conv = db.conversations.getOrCreateActive(customer.id);
          db.messages.create(conv.id, 'outbound', confirmMsg, sendRes.messageSid, 'sent');
          whatsappSent = true;
        } catch {
          // Keep appointment even if notification fails
        }
      }

      res.json({
        success: true,
        appointment: appt,
        customer,
        whatsappSent,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || String(err) });
    }
  });

  // Doctor directly reschedules an appointment with optional override and WhatsApp ping
  router.post('/api/appointments/:id/reschedule-direct', requireAdminAuth, async (req: Request, res: Response) => {
    const appointmentId = String(req.params.id);
    const { date, time, visit_type, address, notes, override, send_whatsapp } = req.body;

    if (!date || !time) {
      res.status(400).json({ error: 'Date and time are required for rescheduling.' });
      return;
    }

    const appt = db.appointments.findById(appointmentId);
    if (!appt) {
      res.status(404).json({ error: 'Appointment not found' });
      return;
    }

    const cleanVisitType = visit_type || appt.visit_type;
    const cleanAddress = address !== undefined ? address : appt.address;

    if (cleanVisitType === 'home_visit' && (!cleanAddress || !String(cleanAddress).trim())) {
      res.status(400).json({ error: 'Address is required for home visits.' });
      return;
    }

    const newStart = beirutDateTimeToUtc(date, time);
    if (isNaN(newStart.getTime())) {
      res.status(400).json({ error: 'Invalid date or time format.' });
      return;
    }

    const existingDurationMs = (new Date(appt.end_time).getTime() - new Date(appt.start_time).getTime()) || (60 * 60 * 1000);
    const newEnd = new Date(newStart.getTime() + existingDurationMs);

    try {
      let updatedAppt: Appointment;
      if (scheduler) {
        updatedAppt = await scheduler.rescheduleAppointment({
          appointmentId: appt.id,
          newStartTime: newStart.toISOString(),
          newEndTime: newEnd.toISOString(),
          visitType: cleanVisitType,
          address: cleanAddress,
          allowOverride: Boolean(override),
        });
      } else {
        db.appointments.reschedule(
          appt.id,
          newStart.toISOString(),
          newEnd.toISOString(),
          cleanVisitType,
          cleanAddress
        );
        updatedAppt = db.appointments.findById(appt.id)!;
      }

      // Update notes if provided or log manual reschedule
      const logNote = `[Directly Rescheduled by Doctor to ${date} at ${time}${override ? ' (Override)' : ''}]`;
      const combinedNotes = [appt.notes || '', notes || '', logNote].filter(Boolean).join('\n');
      db.appDb.db.prepare('UPDATE appointments SET notes = ? WHERE id = ?').run(combinedNotes, appt.id);

      const customer = db.customers.findById(appt.customer_id);
      let whatsappSent = false;
      if (send_whatsapp && gateway && customer && !customer.opted_out) {
        try {
          const visitDetails = cleanVisitType === 'home_visit' ? 'Home Visit' : 'In-Office Consultation';
          const msg = `Hello ${customer.name || 'there'}! Your ${appt.service} appointment has been rescheduled to ${date} at ${time} (${visitDetails}). See you then!`;
          const sendRes = await gateway.sendMessage(customer.phone, msg, customer.id);
          const conv = db.conversations.getOrCreateActive(customer.id);
          db.messages.create(conv.id, 'outbound', msg, sendRes.messageSid, 'sent');
          whatsappSent = true;
        } catch {
          // Continue if send fails
        }
      }

      res.json({
        success: true,
        appointment: db.appointments.findById(appt.id),
        whatsappSent,
      });
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
            const nextDayStr = getBeirutTodayStr(nextDay);
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
      outreachMessage = `Hello ${customer.name || 'Patient'}, we need to reschedule your ${appt.service} appointment originally scheduled for ${new Date(appt.start_time).toLocaleString('en-US', { timeZone: 'Asia/Beirut' })}${reasonText}.${specificText}`;
    }

    // Dispatch via WhatsApp Gateway
    const sendRes = await gateway.sendMessage(customer.phone, outreachMessage, customer.id,{category:'schedule_change',variables:{'1':new Date(appt.start_time).toLocaleString('en-US',{timeZone:'Asia/Beirut'})}});
    const conv = db.conversations.getOrCreateActive(customer.id);
    db.messages.create(conv.id, 'outbound', outreachMessage, sendRes.messageSid, 'sent');

    // Update appointment status and notes
    const logDetails = proposedDate && proposedTime ? `proposing ${proposedDate} at ${proposedTime}` : `prompt: "${doctorPrompt || 'flexible slots'}"`;
    const updatedNotes = [
      appt.notes || '',
      `[Doctor AI Reschedule Sent at ${new Date().toISOString()} (${logDetails})]`,
    ].filter(Boolean).join('\n');

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

    const manualConversation=db.conversations.getOrCreateActive(customer.id);
    db.conversations.updateStatus(manualConversation.id,'doctor_active');
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
  router.use(express.static(path.resolve(process.cwd(), 'public'), { index: false }));

  const sendAppHtml = (req: Request, res: Response) => {

    const indexPath = path.resolve(process.cwd(), 'public', 'index.html');
    if (!fs.existsSync(indexPath)) {
      res.status(500).send('React frontend bundle not found. Please run "node client/build.js".');
      return;
    }
    let html = fs.readFileSync(indexPath, 'utf-8');
    // Inject admin key so React app can immediately authenticate API calls
    const keyScript = `<script>window.__CSRF_TOKEN__ = ${JSON.stringify(res.locals.csrfToken || '')};</script>`;
    html = html.replace('</head>', `  ${keyScript}\n</head>`);
    res.type('html').send(html);
  };

  router.get('/', requireAdminAuth, sendAppHtml);
  router.get('/dashboard', requireAdminAuth, sendAppHtml);
  router.get('/simulator', requireAdminAuth, sendAppHtml);

  return router;
}
