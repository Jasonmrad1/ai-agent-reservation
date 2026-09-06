import { Router, Request, Response, NextFunction } from 'express';
import { DatabaseContext } from '../db/index.js';
import { BillingService } from '../billing/service.js';
import { SchedulingEngine } from '../calendar/scheduler.js';
import { WhatsAppGateway } from '../twilio/client.js';
import { GeminiClient } from '../gemini/agent.js';

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

  // --- API Endpoints ---

  // 1. Availability Rules & Overrides
  router.get('/api/availability', requireAdminAuth, (req: Request, res: Response) => {
    const rules = db.availability.getAllRules();
    const overrides = db.availability.getAllOverrides();
    res.json({ rules, overrides });
  });

  router.post('/api/availability/rules', requireAdminAuth, (req: Request, res: Response) => {
    const { day_of_week, start_time, end_time, is_active } = req.body;
    if (day_of_week === undefined || !start_time || !end_time) {
      res.status(400).json({ error: 'Missing day_of_week, start_time, or end_time' });
      return;
    }
    db.availability.updateRule(Number(day_of_week), start_time, end_time, Boolean(is_active));
    res.json({ success: true, rules: db.availability.getAllRules() });
  });

  router.post('/api/availability/rules/batch', requireAdminAuth, (req: Request, res: Response) => {
    const { rules } = req.body;
    if (!Array.isArray(rules)) {
      res.status(400).json({ error: 'Rules must be an array' });
      return;
    }
    db.availability.updateRulesBatch(rules);
    res.json({ success: true, rules: db.availability.getAllRules() });
  });

  router.post('/api/availability/overrides', requireAdminAuth, (req: Request, res: Response) => {
    const { date, is_unavailable, start_time, end_time, reason } = req.body;
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
    });
    res.json({ success: true, override });
  });

  router.delete('/api/availability/overrides/:id', requireAdminAuth, (req: Request, res: Response) => {
    db.availability.deleteOverride(String(req.params.id));
    res.json({ success: true });
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
    const { doctorPrompt } = req.body;

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

    // Get 2-3 upcoming candidate slots using scheduler if available
    let suggestedSlots: string[] = [];
    if (scheduler) {
      try {
        const apptDate = new Date(appt.start_time);
        for (let i = 1; i <= 3; i++) {
          const nextDay = new Date(apptDate.getTime() + i * 24 * 60 * 60 * 1000);
          const nextDayStr = nextDay.toISOString().split('T')[0];
          const openSlots = await scheduler.getAvailableSlots(nextDayStr, appt.visit_type);
          if (openSlots.length > 0) {
            suggestedSlots.push(`${nextDayStr} at ${openSlots.slice(0, 2).join(' or ')}`);
          }
          if (suggestedSlots.length >= 2) break;
        }
      } catch {
        // Fallback gracefully
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
        suggestedSlots,
      });
    } else {
      const slotText = suggestedSlots.length > 0 ? ` Suggested open times: ${suggestedSlots.join('; ')}.` : '';
      const reasonText = doctorPrompt ? ` (${doctorPrompt})` : '';
      outreachMessage = `Hello ${customer.name || 'Patient'}, we need to reschedule your ${appt.service} appointment originally scheduled for ${new Date(appt.start_time).toLocaleString()}${reasonText}.${slotText} Please reply with your preferred day and time!`;
    }

    // Dispatch via WhatsApp Gateway
    const sendRes = await gateway.sendMessage(customer.phone, outreachMessage, customer.id);
    const conv = db.conversations.getOrCreateActive(customer.id);
    db.messages.create(conv.id, 'outbound', outreachMessage, sendRes.messageSid, 'sent');

    // Update appointment status and notes
    const updatedNotes = [
      appt.notes || '',
      `[Doctor AI Reschedule Prompt Sent at ${new Date().toISOString()}: "${doctorPrompt || 'Reschedule requested'}"]`,
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

  // 5. Admin Dashboard Web UI - Microsoft Teams Calendar Experience
  router.get('/dashboard', (req: Request, res: Response) => {
    const key = (req.query.key as string) || '';
    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Practice Management Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #000000;
      --bg-subtle: #08090b;
      --surface: #0e1014;
      --surface-elevated: #15181f;
      --surface-hover: #1c212a;
      --border: #1a1e27;
      --border-subtle: #12151c;
      --border-focus: #00ff88;
      --emerald: #00ff88;
      --emerald-subtle: rgba(0, 255, 136, 0.12);
      --emerald-border: rgba(0, 255, 136, 0.35);
      --emerald-hover: #00e67a;
      --emerald-text: #00ff88;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --text-subtle: #64748b;
      --amber: #fbbf24;
      --amber-subtle: rgba(251, 191, 36, 0.1);
      --amber-border: rgba(251, 191, 36, 0.25);
      --red: #f87171;
      --red-subtle: rgba(248, 113, 113, 0.1);
      --red-border: rgba(248, 113, 113, 0.25);
      --sky: #38bdf8;
      --sky-subtle: rgba(56, 189, 248, 0.12);
      --sky-border: rgba(56, 189, 248, 0.3);
      --purple: #c084fc;
      --purple-subtle: rgba(192, 132, 252, 0.12);
      --purple-border: rgba(192, 132, 252, 0.3);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }
    .mono { font-family: 'JetBrains Mono', monospace; }

    /* Teams Top Bar */
    .teams-top-bar {
      background: var(--bg-subtle);
      border-bottom: 1px solid var(--border);
      padding: 0 24px;
      height: 60px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 50;
      backdrop-filter: blur(12px);
    }
    .teams-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .brand-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      font-size: 15px;
      color: #fff;
    }
    .brand-logo svg {
      width: 22px;
      height: 22px;
      stroke: var(--emerald);
    }
    .nav-group {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 3px;
    }
    .nav-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-family: inherit;
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    .nav-btn:hover {
      background: var(--surface-hover);
      color: #fff;
    }
    .nav-btn.today {
      color: #fff;
      font-weight: 600;
      padding: 5px 12px;
    }
    .date-range-label {
      font-size: 14.5px;
      font-weight: 600;
      color: #fff;
      letter-spacing: -0.01em;
      min-width: 170px;
    }
    .teams-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .preset-pills {
      display: flex;
      gap: 5px;
      align-items: center;
    }
    .preset-btn {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text-muted);
      border-radius: 5px;
      padding: 5px 11px;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }
    .preset-btn:hover {
      color: #fff;
      border-color: #3f414d;
      background: var(--surface-hover);
    }
    .btn {
      padding: 6px 14px;
      border-radius: 6px;
      border: 1px solid transparent;
      cursor: pointer;
      font-weight: 500;
      font-size: 12.5px;
      font-family: inherit;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .btn-emerald {
      background: var(--emerald);
      color: #000000;
      font-weight: 700;
      box-shadow: 0 0 12px rgba(0, 255, 136, 0.25);
    }
    .btn-emerald:hover {
      background: var(--emerald-hover);
      box-shadow: 0 0 18px rgba(0, 255, 136, 0.45);
    }
    .btn-secondary { background: var(--surface-elevated); border-color: var(--border); color: #e4e4e7; }
    .btn-secondary:hover { background: var(--surface-hover); border-color: #383a45; color: #fff; }
    .btn-purple { background: var(--purple-subtle); border-color: var(--purple-border); color: var(--purple); font-weight: 600; }
    .btn-purple:hover { background: rgba(192, 132, 252, 0.2); }
    .btn-danger { background: var(--red-subtle); border-color: var(--red-border); color: var(--red); }
    .btn-danger:hover { background: rgba(248, 113, 113, 0.2); }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      background: var(--emerald-subtle);
      border: 1px solid var(--emerald-border);
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 11.5px;
      color: var(--emerald-text);
      font-weight: 500;
    }
    .pulse-dot {
      width: 6px;
      height: 6px;
      background: var(--emerald-text);
      border-radius: 50%;
      animation: pulse 2s infinite ease-in-out;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.75); } }

    /* Main Calendar Canvas */
    .calendar-app-container {
      padding: 16px 24px 32px;
      max-width: 1500px;
      margin: 0 auto;
    }
    .calendar-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .calendar-body-scroll {
      display: flex;
      overflow-x: auto;
      position: relative;
      user-select: none;
    }
    .time-axis {
      width: 58px;
      flex-shrink: 0;
      border-right: 1px solid var(--border);
      background: #0d0e11;
      padding-top: 60px; /* aligns with day headers */
    }
    .time-axis-slot {
      height: 36px;
      font-size: 10.5px;
      color: var(--text-subtle);
      font-family: 'JetBrains Mono', monospace;
      text-align: right;
      padding-right: 10px;
      transform: translateY(-6px);
      box-sizing: border-box;
    }
    .days-columns-grid {
      display: flex;
      flex: 1;
      min-width: 820px;
    }
    .day-column {
      flex: 1;
      border-right: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      position: relative;
      background: #111216;
    }
    .day-column:last-child {
      border-right: none;
    }
    .day-col-header {
      height: 60px;
      border-bottom: 1px solid var(--border);
      background: #141519;
      padding: 6px 8px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 3px;
    }
    .day-header-meta {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .day-abbr {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-subtle);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .day-num {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12.5px;
      font-weight: 600;
      color: #fff;
    }
    .day-num.today {
      background: var(--emerald);
      color: #fff;
      box-shadow: 0 0 10px rgba(36, 180, 126, 0.4);
    }
    .day-col-status {
      font-size: 10.5px;
      font-family: 'JetBrains Mono', monospace;
      color: var(--emerald-text);
      cursor: pointer;
      background: var(--emerald-subtle);
      border: 1px solid var(--emerald-border);
      padding: 1px 7px;
      border-radius: 4px;
      transition: all 0.15s;
    }
    .day-col-status:hover {
      background: rgba(36, 180, 126, 0.22);
    }
    .day-col-status.closed {
      color: var(--text-subtle);
      background: rgba(255,255,255,0.03);
      border-color: var(--border-subtle);
    }

    .day-col-track {
      height: 504px; /* 14 hours (07:00-21:00) * 36px */
      position: relative;
      background:
        repeating-linear-gradient(
          to bottom,
          transparent,
          transparent 35px,
          rgba(255, 255, 255, 0.03) 35px,
          rgba(255, 255, 255, 0.03) 36px
        );
    }
    .day-col-track.day-closed {
      background:
        repeating-linear-gradient(
          45deg,
          rgba(255, 255, 255, 0.02),
          rgba(255, 255, 255, 0.02) 10px,
          transparent 10px,
          transparent 20px
        );
    }
    .closed-overlay-btn {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--surface-elevated);
      border: 1px solid var(--border);
      color: var(--text-subtle);
      font-size: 11px;
      padding: 5px 10px;
      border-radius: 4px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .closed-overlay-btn:hover {
      color: #fff;
      border-color: var(--emerald);
      background: var(--surface-hover);
    }

    /* Draggable Working Hours Shaded Window */
    .avail-block {
      position: absolute;
      left: 3px;
      right: 3px;
      background: rgba(0, 255, 136, 0.08);
      border: 1.5px dashed rgba(0, 255, 136, 0.45);
      border-radius: 6px;
      z-index: 10;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
      cursor: grab;
      touch-action: none;
      transition: background-color 0.15s, border-color 0.15s;
    }
    .avail-block:hover {
      border-color: #00ff88;
      background: rgba(0, 255, 136, 0.11);
    }
    .avail-block.is-dragging, .avail-block:active {
      cursor: grabbing;
      background: rgba(0, 255, 136, 0.16);
      border-color: #00ff88;
      box-shadow: 0 0 12px rgba(0, 255, 136, 0.25);
    }
    .avail-drag-handle {
      height: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: ns-resize;
      background: rgba(0, 255, 136, 0.18);
      touch-action: none;
      transition: background-color 0.15s;
    }
    .avail-drag-handle:hover {
      background: rgba(0, 255, 136, 0.4);
    }
    .avail-drag-handle::after {
      content: "";
      width: 24px;
      height: 2px;
      background: #00ff88;
      border-radius: 1px;
      box-shadow: 0 0 4px #00ff88;
    }
    .avail-drag-handle.top { border-bottom: 1px solid rgba(0, 255, 136, 0.2); }
    .avail-drag-handle.bottom { border-top: 1px solid rgba(0, 255, 136, 0.2); }
    .avail-block-label {
      padding: 3px 4px;
      font-size: 10.5px;
      font-weight: 600;
      color: #00ff88;
      text-align: center;
      font-family: 'JetBrains Mono', monospace;
      cursor: grab;
      user-select: none;
    }

    /* Microsoft Teams Meeting Cards - Low Opacity Neon Green */
    .teams-meeting-card {
      position: absolute;
      left: 4px;
      right: 4px;
      background: rgba(0, 255, 136, 0.12);
      border: 1px solid rgba(0, 255, 136, 0.28);
      border-left: 4px solid #00ff88;
      border-radius: 6px;
      padding: 5px 8px;
      cursor: pointer;
      z-index: 20;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      gap: 2px;
      backdrop-filter: blur(4px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      transition: transform 0.1s ease, box-shadow 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
    }
    .teams-meeting-card:hover {
      transform: translateY(-1px);
      background: rgba(0, 255, 136, 0.19);
      box-shadow: 0 4px 14px rgba(0, 255, 136, 0.22);
      border-color: rgba(0, 255, 136, 0.6);
      z-index: 25;
    }
    .teams-meeting-card.home-visit {
      background: rgba(0, 255, 136, 0.11);
      border-color: rgba(0, 255, 136, 0.32);
      border-left: 4px solid #00ff88;
    }
    .teams-meeting-card.in-office {
      background: rgba(0, 255, 136, 0.13);
      border-color: rgba(0, 255, 136, 0.32);
      border-left: 4px solid #00ff88;
    }
    .meeting-title {
      font-size: 11.5px;
      font-weight: 700;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meeting-time {
      font-size: 10px;
      color: #00ff88;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
    }
    .meeting-patient {
      font-size: 10.5px;
      color: #f1f5f9;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meeting-badge {
      font-size: 9.5px;
      color: #94a3b8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 1px;
    }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .badge-home { background: var(--sky-subtle); color: var(--sky); border: 1px solid var(--sky-border); }
    .badge-office { background: var(--purple-subtle); color: var(--purple); border: 1px solid var(--purple-border); }
    .badge-paid { background: var(--emerald-subtle); color: var(--emerald-text); border: 1px solid var(--emerald-border); }
    .badge-unpaid { background: var(--red-subtle); color: var(--red); border: 1px solid var(--red-border); }
    .badge-rescheduled { background: var(--amber-subtle); color: var(--amber); border: 1px solid var(--amber-border); }
    .badge-pending { background: rgba(255,255,255,0.06); color: #d4d4d8; border: 1px solid var(--border); }

    /* Modals & Popovers */
    .modal-backdrop {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 16px;
    }
    .modal-backdrop.active { display: flex; animation: fadeIn 0.15s ease-out; }
    .modal-card {
      background: #16171c;
      border: 1px solid var(--border);
      border-radius: 10px;
      width: 100%;
      max-width: 520px;
      overflow: hidden;
      box-shadow: 0 16px 40px rgba(0,0,0,0.6);
    }
    .modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #141519;
    }
    .modal-body { padding: 20px; }
    .modal-footer {
      padding: 14px 20px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      background: #141519;
    }
    .chip-group { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 14px; }
    .chip {
      background: var(--surface-elevated);
      border: 1px solid var(--border);
      color: var(--text-muted);
      border-radius: 9999px;
      padding: 4px 10px;
      font-size: 11.5px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .chip:hover { color: #fff; border-color: #454754; background: var(--surface-hover); }

    /* Form controls in modals */
    input[type="text"], input[type="date"], input[type="time"], textarea {
      background: #0d0e11;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: #f4f4f6;
      padding: 7px 11px;
      font-size: 13px;
      font-family: inherit;
    }
    input:focus, textarea:focus { outline: none; border-color: var(--border-focus); }

    /* Toast */
    .toast-container { position: fixed; bottom: 24px; right: 24px; z-index: 1000; }
    .toast {
      background: #1c1e24;
      border: 1px solid var(--emerald);
      color: #fff;
      padding: 10px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      display: none;
      align-items: center;
      gap: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      animation: slideUp 0.2s ease-out;
    }
    @keyframes slideUp { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }

    .drag-tooltip {
      position: fixed;
      z-index: 999;
      background: #18191f;
      border: 1px solid var(--emerald);
      color: #fff;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-family: 'JetBrains Mono', monospace;
      pointer-events: none;
      box-shadow: 0 4px 15px rgba(0,0,0,0.6);
      display: none;
      transform: translate(-50%, -130%);
    }

    /* Day row item in work hours modal */
    .day-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .day-item:last-child { border-bottom: none; }
    .switch-wrap { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .switch { position: relative; width: 34px; height: 18px; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #2b2d35; border-radius: 18px; transition: .2s; }
    .slider:before { position: absolute; content: ""; height: 12px; width: 12px; left: 3px; bottom: 3px; background-color: #fff; border-radius: 50%; transition: .2s; }
    input:checked + .slider { background-color: var(--emerald); }
    input:checked + .slider:before { transform: translateX(16px); }

    /* Contact Action Buttons */
    .contact-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
    }
    .contact-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.15s;
    }
    .contact-chip.whatsapp {
      background: rgba(0, 255, 136, 0.14);
      color: #00ff88;
      border: 1px solid rgba(0, 255, 136, 0.35);
    }
    .contact-chip.whatsapp:hover {
      background: rgba(0, 255, 136, 0.25);
      border-color: #00ff88;
    }
    .contact-chip.call {
      background: rgba(56, 189, 248, 0.14);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.35);
    }
    .contact-chip.call:hover {
      background: rgba(56, 189, 248, 0.25);
      border-color: #38bdf8;
    }

    /* WhatsApp Conversation Thread in Details Modal */
    .chat-thread-container {
      max-height: 180px;
      overflow-y: auto;
      background: #090a0d;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .chat-bubble {
      max-width: 86%;
      padding: 7px 11px;
      border-radius: 8px;
      font-size: 12px;
      line-height: 1.4;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .chat-bubble.patient {
      align-self: flex-start;
      background: #14171f;
      border: 1px solid #232836;
      color: #f1f5f9;
      border-bottom-left-radius: 2px;
    }
    .chat-bubble.gemini {
      align-self: flex-end;
      background: rgba(0, 255, 136, 0.12);
      border: 1px solid rgba(0, 255, 136, 0.3);
      color: #ffffff;
      border-bottom-right-radius: 2px;
    }
    .chat-bubble-sender {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .chat-bubble.patient .chat-bubble-sender { color: var(--sky); }
    .chat-bubble.gemini .chat-bubble-sender { color: #00ff88; }
    .chat-bubble-text { font-size: 11.5px; }

    .day-closed-notice {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: var(--text-subtle);
      font-size: 11px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      pointer-events: none;
    }

    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { padding: 8px 12px; font-size: 11px; text-transform: uppercase; color: var(--text-subtle); border-bottom: 1px solid var(--border); }
    td { padding: 8px 12px; border-bottom: 1px solid var(--border-subtle); font-size: 12px; }
  </style>
</head>
<body>
  <!-- Microsoft Teams Style Top Bar -->
  <header class="teams-top-bar">
    <div class="teams-left">
      <div class="brand-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
        <span>Calendar</span>
      </div>

      <div class="nav-group">
        <button class="nav-btn" onclick="prevWeek()" title="Previous Week">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <button class="nav-btn today" onclick="todayWeek()">Today</button>
        <button class="nav-btn" onclick="nextWeek()" title="Next Week">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </div>

      <div class="date-range-label" id="currentMonthYear">-</div>
    </div>

    <div class="teams-right">
      <div class="preset-pills">
        <button class="preset-btn" onclick="applyPreset('standard')">Standard 9-5</button>
        <button class="preset-btn" onclick="applyPreset('extended')">Extended 8-6</button>
        <button class="preset-btn" onclick="applyPreset('all')">All 7 Days</button>
      </div>

      <button class="btn btn-emerald" onclick="openWorkHoursModal()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        Weekly Work Hours
      </button>

      <button class="btn btn-secondary" id="toggleHoursBtn" onclick="toggleHoursOverlay()">
        Show Hours on Calendar
      </button>

      <button class="btn btn-secondary" onclick="saveAllWeeklyHours()" style="display: none;">
        Save All Weekly Hours
      </button>

      <div class="status-pill">
        <span class="pulse-dot"></span>
        <span>WhatsApp Live</span>
      </div>
    </div>
  </header>

  <!-- Main Teams Calendar Canvas -->
  <main class="calendar-app-container">
    <div class="calendar-card">
      <div class="calendar-body-scroll">
        <div class="time-axis" id="timeAxis"></div>
        <div class="days-columns-grid" id="daysColumnsGrid"></div>
      </div>
    </div>
  </main>

  <!-- Teams Meeting Details Drawer / Popover Modal -->
  <div id="reservationDetailsModal" class="modal-backdrop">
    <div class="modal-card" style="max-width: 560px;">
      <div class="modal-header">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span id="detailVisitBadge" class="badge badge-office">IN-OFFICE</span>
          <h3 id="detailServiceTitle" style="font-size: 15px; color: #fff; font-weight: 600;">General Consultation</h3>
        </div>
        <button onclick="closeReservationModal()" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px;">✕</button>
      </div>
      <div class="modal-body" style="max-height: 520px; overflow-y: auto;">
        <!-- Date & Time + Status & Fee -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; background: #0c0e12; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px;">
          <div style="display: flex; gap: 10px;">
            <div style="color: var(--emerald); padding-top: 2px;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div>
              <div id="detailDateTime" style="font-size: 13.5px; font-weight: 600; color: #fff;">-</div>
              <div style="margin-top: 4px; display: flex; align-items: center; gap: 8px;">
                <span id="detailStatusPill" class="badge badge-paid">CONFIRMED</span>
                <span id="detailDurationPrice" style="font-size: 12px; color: #00ff88; font-family: 'JetBrains Mono', monospace; font-weight: 600;">$120 • 60 min</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Patient Info Card with Direct Contact -->
        <div style="background: #0c0e12; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-subtle); letter-spacing: 0.05em; margin-bottom: 6px;">Patient Contact Information</div>
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div>
              <div id="detailPatientName" style="font-size: 15px; font-weight: 700; color: #fff;">-</div>
              <div id="detailPatientPhone" class="mono" style="font-size: 13px; color: #94a3b8; margin-top: 2px;">-</div>
            </div>
            <div class="contact-actions">
              <a id="detailWhatsAppBtn" href="#" target="_blank" class="contact-chip whatsapp">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.664-.698c.969.585 1.777.893 2.796.893 3.183 0 5.77-2.587 5.77-5.766.001-3.182-2.585-5.78-5.77-5.78zm3.385 8.163c-.145.411-.747.781-1.026.829-.272.046-.622.079-1.921-.458-1.523-.629-2.531-2.164-2.61-2.269-.079-.105-.623-.83-.623-1.583 0-.753.395-1.123.535-1.275.14-.152.307-.19.41-.19.102 0 .204.002.294.006.096.004.225-.036.35.267.129.313.439 1.071.478 1.149.039.078.065.17.013.273-.051.103-.078.167-.154.257-.076.09-.16.2-.229.268-.077.078-.158.163-.068.318.09.155.402.663.864 1.074.595.53 1.096.694 1.251.771.155.077.246.068.338-.039.092-.107.394-.46.5-.618.105-.158.211-.131.353-.078.142.052.902.425 1.057.503.155.078.258.117.296.182.038.065.038.38-.107.791z"/></svg>
                WhatsApp
              </a>
              <a id="detailCallBtn" href="#" class="contact-chip call">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                Call
              </a>
            </div>
          </div>
        </div>

        <!-- Location / Address Card -->
        <div style="background: #0c0e12; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-subtle); letter-spacing: 0.05em; margin-bottom: 4px;">Location / Address</div>
          <div style="display: flex; gap: 10px; align-items: flex-start;">
            <div style="color: #f43f5e; padding-top: 2px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            </div>
            <div id="detailAddress" style="font-size: 13px; color: #e4e4e7; line-height: 1.4;">-</div>
          </div>
        </div>

        <!-- Booking Symptoms / Notes captured by Gemini -->
        <div id="detailNotesContainer" style="background: #0c0e12; border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-subtle); letter-spacing: 0.05em; margin-bottom: 4px;">Symptoms & Notes (Captured by AI)</div>
          <div id="detailNotes" style="font-size: 12.5px; color: #f1f5f9; line-height: 1.4;">-</div>
        </div>

        <!-- WhatsApp Conversation Thread with Gemini -->
        <div id="detailChatContainer" style="margin-top: 14px; display: none;">
          <div style="font-size: 11px; text-transform: uppercase; color: var(--text-subtle); letter-spacing: 0.05em; margin-bottom: 6px;">WhatsApp Chat History with AI</div>
          <div id="detailChatHistory" class="chat-thread-container"></div>
        </div>
      </div>
      <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
        <button class="btn btn-danger" id="detailCancelBtn" onclick="cancelFromDetails()">Cancel Visit</button>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-purple" id="detailRescheduleBtn" onclick="openRescheduleFromDetails()">
            AI Reschedule
          </button>
          <button class="btn btn-emerald" id="detailCompleteBtn" onclick="completeFromDetails()">
            Complete & Bill
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Weekly Work Hours Drawer / Settings Modal -->
  <div id="workHoursModal" class="modal-backdrop">
    <div class="modal-card" style="max-width: 580px;">
      <div class="modal-header">
        <div>
          <h3 style="margin: 0; color: #fff; font-size: 15px;">Weekly Work Hours</h3>
          <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-subtle);">Set your weekly practice schedule and bookable time windows.</p>
        </div>
        <button onclick="closeWorkHoursModal()" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px;">✕</button>
      </div>
      <div class="modal-body" style="max-height: 480px; overflow-y: auto;">
        <div style="display: flex; gap: 6px; margin-bottom: 16px;">
          <button class="preset-btn" onclick="applyPreset('standard')">Standard 9-5 (M-F)</button>
          <button class="preset-btn" onclick="applyPreset('extended')">Extended 8-6 (M-Sat)</button>
          <button class="preset-btn" onclick="applyPreset('all')">All 7 Days</button>
        </div>
        <div id="weeklyRulesList"></div>

        <!-- Date Blockouts -->
        <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border);">
          <div style="font-size: 12.5px; font-weight: 600; color: #fff; margin-bottom: 8px;">Date Blockouts & Holidays</div>
          <div style="max-height: 120px; overflow-y: auto; margin-bottom: 12px;">
            <table id="overridesTable">
              <thead>
                <tr><th>Date</th><th>Status</th><th>Reason</th><th>Action</th></tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
          <div style="display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap;">
            <div>
              <label style="font-size: 11px; color: var(--text-subtle); display: block; margin-bottom: 3px;">Date</label>
              <input type="date" id="overrideDate" style="width: 140px;">
            </div>
            <div>
              <label style="font-size: 11px; color: var(--text-subtle); display: block; margin-bottom: 3px;">Reason</label>
              <input type="text" id="overrideReason" placeholder="e.g. Vacation" style="width: 200px;">
            </div>
            <button class="btn btn-emerald" onclick="addOverride()">Add Off Day</button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeWorkHoursModal()">Close</button>
        <button class="btn btn-emerald" onclick="saveAllWeeklyHours()">Save All Weekly Hours</button>
      </div>
    </div>
  </div>

  <!-- AI Reschedule Modal Dialog -->
  <div id="aiRescheduleModal" class="modal-backdrop">
    <div class="modal-card">
      <div class="modal-header">
        <h3 style="font-size: 15px; color: #fff;">Prompt AI to Reschedule</h3>
        <button onclick="closeRescheduleModal()" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px;">✕</button>
      </div>
      <div class="modal-body">
        <div style="background: #0d0e11; border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; margin-bottom: 16px;">
          <div style="font-size: 13.5px; font-weight: 600; color: #fff;" id="modalPatientName">-</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;" id="modalApptTime">-</div>
        </div>
        
        <label style="font-size: 12px; font-weight: 500; color: var(--text-muted); display: block; margin-bottom: 6px;">
          Directive / Reason for Rescheduling:
        </label>
        
        <div class="chip-group">
          <span class="chip" onclick="applyDirective('Hospital emergency, please pick another day')">Hospital Emergency</span>
          <span class="chip" onclick="applyDirective('Doctor unavailable this morning, suggest afternoon slots')">Morning Conflict</span>
          <span class="chip" onclick="applyDirective('Suggest Wednesday 2pm or Thursday 11am')">Offer Wed / Thu</span>
        </div>

        <textarea id="modalDoctorPrompt" rows="3" style="width: 100%; max-width: 100%;" placeholder="e.g. Doctor called into surgery. Propose alternative slots on Thursday or Friday."></textarea>
        <p style="font-size: 11.5px; color: var(--text-subtle); margin-top: 6px;">
          The AI will compose a natural WhatsApp message with candidate slots from your working hours and dispatch it to the patient.
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeRescheduleModal()">Cancel</button>
        <button class="btn btn-emerald" id="modalSubmitBtn" onclick="submitAiReschedule()">
          Dispatch WhatsApp Request
        </button>
      </div>
    </div>
  </div>

  <!-- Toast Notification & Drag Tooltip -->
  <div class="toast-container">
    <div id="statusToast" class="toast">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--emerald-text)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span id="toastMessage">Success</span>
    </div>
  </div>
  <div id="dragTooltip" class="drag-tooltip"></div>

  <script>
    var adminKey = "${key}";
    var headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + adminKey
    };

    var cachedRules = [];
    var cachedAppointments = [];
    var activeSelectedAppt = null;
    var activeRescheduleApptId = null;
    var dragState = null;
    var showHoursOverlay = false;

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function toggleHoursOverlay() {
      showHoursOverlay = !showHoursOverlay;
      var btn = document.getElementById('toggleHoursBtn');
      if (btn) {
        btn.className = showHoursOverlay ? 'btn btn-emerald' : 'btn btn-secondary';
        btn.innerText = showHoursOverlay ? 'Hide Hours on Calendar' : 'Show Hours on Calendar';
      }
      renderWeeklyGrid();
    }

    var START_HOUR = 7;
    var END_HOUR = 21;
    var TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60;
    var TRACK_HEIGHT = 504;
    var PX_PER_MIN = TRACK_HEIGHT / TOTAL_MINUTES;

    function getMonday(d) {
      var date = new Date(d);
      var day = date.getDay();
      var diff = date.getDate() - day + (day === 0 ? -6 : 1);
      var monday = new Date(date.setDate(diff));
      monday.setHours(0, 0, 0, 0);
      return monday;
    }

    var currentWeekMonday = getMonday(new Date());

    function prevWeek() {
      currentWeekMonday.setDate(currentWeekMonday.getDate() - 7);
      renderWeeklyGrid();
    }

    function nextWeek() {
      currentWeekMonday.setDate(currentWeekMonday.getDate() + 7);
      renderWeeklyGrid();
    }

    function todayWeek() {
      currentWeekMonday = getMonday(new Date());
      renderWeeklyGrid();
    }

    function showToast(msg) {
      var toast = document.getElementById('statusToast');
      var msgElem = document.getElementById('toastMessage');
      msgElem.innerText = msg;
      toast.style.display = 'flex';
      setTimeout(function() { toast.style.display = 'none'; }, 4000);
    }

    function timeToMinutes(tStr) {
      if (!tStr) return START_HOUR * 60;
      var parts = tStr.split(':');
      var h = parseInt(parts[0], 10) || 0;
      var m = parseInt(parts[1], 10) || 0;
      return h * 60 + m;
    }

    function minutesToTime(mins) {
      var clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, mins));
      var h = Math.floor(clamped / 60);
      var m = clamped % 60;
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }

    function minutesToY(mins) {
      var clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, mins));
      return (clamped - (START_HOUR * 60)) * PX_PER_MIN;
    }

    function renderTimeAxis() {
      var axis = document.getElementById('timeAxis');
      if (!axis || axis.children.length > 0) return;
      var html = '';
      for (var h = START_HOUR; h <= END_HOUR; h++) {
        var label = String(h).padStart(2, '0') + ':00';
        html += '<div class="time-axis-slot">' + label + '</div>';
      }
      axis.innerHTML = html;
    }

    var DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    function renderWeeklyGrid() {
      renderTimeAxis();
      var grid = document.getElementById('daysColumnsGrid');
      if (!grid) return;

      var weekDates = [];
      for (var i = 0; i < 7; i++) {
        var wd = new Date(currentWeekMonday);
        wd.setDate(currentWeekMonday.getDate() + i);
        weekDates.push(wd);
      }

      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      var firstD = weekDates[0];
      var lastD = weekDates[6];
      var rangeStr = months[firstD.getMonth()] + ' ' + firstD.getDate() + ' – ' + (firstD.getMonth() === lastD.getMonth() ? '' : months[lastD.getMonth()] + ' ') + lastD.getDate() + ', ' + firstD.getFullYear();
      var monthYearElem = document.getElementById('currentMonthYear');
      if (monthYearElem) monthYearElem.innerText = rangeStr;

      var todayStr = new Date().toDateString();
      var colsHtml = '';

      for (var colIdx = 0; colIdx < 7; colIdx++) {
        var colDate = weekDates[colIdx];
        var dayOfWeek = colDate.getDay();
        var isToday = (colDate.toDateString() === todayStr);

        var rule = null;
        for (var r = 0; r < cachedRules.length; r++) {
          if (Number(cachedRules[r].day_of_week) === dayOfWeek) {
            rule = cachedRules[r];
            break;
          }
        }
        if (!rule) {
          rule = { day_of_week: dayOfWeek, start_time: '09:00', end_time: '17:00', is_active: false };
        }

        var isActive = Boolean(rule.is_active);
        var startMins = timeToMinutes(rule.start_time);
        var endMins = timeToMinutes(rule.end_time);
        var topY = minutesToY(startMins);
        var bottomY = minutesToY(endMins);
        var height = Math.max(24, bottomY - topY);

        var dayAppts = cachedAppointments.filter(function(a) {
          if (a.status === 'cancelled') return false;
          var aDate = new Date(a.start_time);
          return aDate.getFullYear() === colDate.getFullYear() &&
                 aDate.getMonth() === colDate.getMonth() &&
                 aDate.getDate() === colDate.getDate();
        });

        var apptsHtml = '';
        for (var aIdx = 0; aIdx < dayAppts.length; aIdx++) {
          var appt = dayAppts[aIdx];
          var aStart = new Date(appt.start_time);
          var aEnd = appt.end_time ? new Date(appt.end_time) : new Date(aStart.getTime() + 45*60*1000);
          var aStartMin = aStart.getHours() * 60 + aStart.getMinutes();
          var aEndMin = aEnd.getHours() * 60 + aEnd.getMinutes();
          if (aEndMin <= aStartMin) aEndMin = aStartMin + 45;

          var aTop = minutesToY(aStartMin);
          var aHeight = Math.max(36, (aEndMin - aStartMin) * PX_PER_MIN);
          var isHome = (appt.visit_type === 'home_visit');
          var timeStr = aStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          var safeName = (appt.customer_name || 'Patient').replace(/"/g, '&quot;');
          var safeService = (appt.service || 'Consultation').replace(/"/g, '&quot;');
          var locLabel = isHome ? ('Home: ' + (appt.address || 'Address provided')) : 'In-Office Clinic';

          apptsHtml += '<div class="teams-meeting-card ' + (isHome ? 'home-visit' : 'in-office') + '" ' +
            'style="top: ' + aTop + 'px; height: ' + aHeight + 'px;" ' +
            'data-appt-id="' + appt.id + '">' +
            '<div class="meeting-title">' + safeService + '</div>' +
            '<div class="meeting-time">' + timeStr + '</div>' +
            '<div class="meeting-patient">' + safeName + '</div>' +
            '<div class="meeting-badge">' + locLabel + '</div>' +
            '</div>';
        }

        colsHtml += '<div class="day-column" data-day="' + dayOfWeek + '">' +
          '<div class="day-col-header">' +
            '<div class="day-header-meta">' +
              '<span class="day-abbr">' + DAY_NAMES[colIdx] + '</span>' +
              '<span class="day-num ' + (isToday ? 'today' : '') + '">' + colDate.getDate() + '</span>' +
            '</div>' +
            '<span class="day-col-status ' + (isActive ? '' : 'closed') + '" onclick="toggleDayOpen(' + dayOfWeek + ')" title="Click to toggle bookable/closed">' +
              (isActive ? (rule.start_time + ' - ' + rule.end_time) : 'Closed') +
            '</span>' +
          '</div>' +
          '<div class="day-col-track ' + (isActive ? '' : 'day-closed') + '" id="track-' + dayOfWeek + '" data-day="' + dayOfWeek + '">';

        if (!isActive) {
          colsHtml += '<div class="day-closed-notice">Closed</div>';
        } else if (showHoursOverlay) {
          colsHtml += '<div class="avail-block" id="availBlock-' + dayOfWeek + '" data-day="' + dayOfWeek + '" style="top: ' + topY + 'px; height: ' + height + 'px;">' +
            '<div class="avail-drag-handle top" data-handle="top" data-day="' + dayOfWeek + '" title="Drag to adjust start time"></div>' +
            '<div class="avail-block-label" data-handle="move" data-day="' + dayOfWeek + '" title="Drag to shift work hours">' +
              '<span id="blockLabel-' + dayOfWeek + '">' + rule.start_time + ' - ' + rule.end_time + '</span>' +
            '</div>' +
            '<div class="avail-drag-handle bottom" data-handle="bottom" data-day="' + dayOfWeek + '" title="Drag to adjust end time"></div>' +
          '</div>';
        }

        colsHtml += apptsHtml + '</div></div>';
      }

      grid.innerHTML = colsHtml;
    }

    // Teams Meeting Details Popover Modal
    function openReservationModal(id) {
      var appt = null;
      for (var i = 0; i < cachedAppointments.length; i++) {
        if (cachedAppointments[i].id === id) {
          appt = cachedAppointments[i];
          break;
        }
      }
      if (!appt) return;
      activeSelectedAppt = appt;

      var isHome = (appt.visit_type === 'home_visit');
      var badge = document.getElementById('detailVisitBadge');
      badge.className = 'badge ' + (isHome ? 'badge-home' : 'badge-office');
      badge.innerText = isHome ? 'HOME VISIT' : 'IN-OFFICE';

      document.getElementById('detailServiceTitle').innerText = appt.service || 'Medical Consultation';

      var startDate = new Date(appt.start_time);
      var endDate = appt.end_time ? new Date(appt.end_time) : new Date(startDate.getTime() + 60*60*1000);
      var dateStr = startDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
      var timeStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' – ' + endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      document.getElementById('detailDateTime').innerText = dateStr + ' • ' + timeStr;

      var priceElem = document.getElementById('detailDurationPrice');
      var priceVal = appt.price ? ('$' + appt.price) : '$120';
      var durationVal = Math.round((endDate.getTime() - startDate.getTime()) / (60 * 1000)) || 60;
      if (priceElem) priceElem.innerText = priceVal + ' • ' + durationVal + ' min';

      var statusBadge = document.getElementById('detailStatusPill');
      var st = (appt.status || 'confirmed').toLowerCase();
      statusBadge.className = 'badge ' + (st === 'confirmed' ? 'badge-paid' : st === 'rescheduled' ? 'badge-rescheduled' : st === 'completed' ? 'badge-paid' : 'badge-pending');
      statusBadge.innerText = st.toUpperCase();

      document.getElementById('detailPatientName').innerText = appt.customer_name || 'Patient';
      
      var rawPhone = appt.customer_phone || '-';
      document.getElementById('detailPatientPhone').innerText = rawPhone;
      var cleanPhone = rawPhone.replace(/[^0-9]/g, '');

      var waBtn = document.getElementById('detailWhatsAppBtn');
      var callBtn = document.getElementById('detailCallBtn');
      if (cleanPhone) {
        if (waBtn) {
          waBtn.href = 'https://wa.me/' + cleanPhone;
          waBtn.style.display = 'inline-flex';
        }
        if (callBtn) {
          callBtn.href = 'tel:+' + cleanPhone;
          callBtn.style.display = 'inline-flex';
        }
      } else {
        if (waBtn) waBtn.style.display = 'none';
        if (callBtn) callBtn.style.display = 'none';
      }

      var addrElem = document.getElementById('detailAddress');
      if (isHome) {
        var rawAddr = appt.address || 'Address provided via WhatsApp';
        addrElem.innerHTML = escapeHtml(rawAddr) + ' &nbsp;<a href="https://maps.google.com/?q=' + encodeURIComponent(rawAddr) + '" target="_blank" style="color: var(--sky); font-size: 11.5px; text-decoration: underline;">Open in Google Maps ↗</a>';
      } else {
        addrElem.innerText = 'Clinic Office (In-Person Patient Consultation)';
      }

      var notesElem = document.getElementById('detailNotes');
      var notesBox = document.getElementById('detailNotesContainer');
      if (appt.notes) {
        notesElem.innerText = appt.notes;
        notesBox.style.display = 'block';
      } else {
        notesElem.innerText = 'No specific symptoms or directives noted.';
        notesBox.style.display = 'block';
      }

      // WhatsApp conversation thread with Gemini
      var chatContainer = document.getElementById('detailChatContainer');
      var chatBox = document.getElementById('detailChatHistory');
      if (chatContainer && chatBox) {
        if (appt.conversation_history && appt.conversation_history.length > 0) {
          chatContainer.style.display = 'block';
          var chatHtml = '';
          for (var c = 0; c < appt.conversation_history.length; c++) {
            var m = appt.conversation_history[c];
            var isInbound = (m.direction === 'inbound');
            var senderLabel = isInbound ? (appt.customer_name || 'Patient') : 'Gemini AI Receptionist';
            chatHtml += '<div class="chat-bubble ' + (isInbound ? 'patient' : 'gemini') + '">' +
              '<div class="chat-bubble-sender">' + escapeHtml(senderLabel) + '</div>' +
              '<div class="chat-bubble-text">' + escapeHtml(m.body) + '</div>' +
              '</div>';
          }
          chatBox.innerHTML = chatHtml;
        } else {
          chatContainer.style.display = 'none';
        }
      }

      document.getElementById('reservationDetailsModal').classList.add('active');
    }

    function closeReservationModal() {
      document.getElementById('reservationDetailsModal').classList.remove('active');
      activeSelectedAppt = null;
    }

    function openRescheduleFromDetails() {
      if (!activeSelectedAppt) return;
      var a = activeSelectedAppt;
      closeReservationModal();
      openRescheduleModal(a.id, a.customer_name || 'Patient', a.start_time);
    }

    async function completeFromDetails() {
      if (!activeSelectedAppt) return;
      if (!confirm('Mark visit as completed and dispatch invoice receipt to patient on WhatsApp?')) return;
      await fetch('/admin/api/appointments/' + activeSelectedAppt.id + '/complete?key=' + adminKey, { method: 'POST', headers: headers });
      showToast('Appointment completed & WhatsApp receipt dispatched.');
      closeReservationModal();
      loadAppointments();
    }

    async function cancelFromDetails() {
      if (!activeSelectedAppt) return;
      if (!confirm('Are you sure you want to cancel this visit?')) return;
      await fetch('/admin/api/appointments/' + activeSelectedAppt.id + '/cancel?key=' + adminKey, { method: 'POST', headers: headers });
      showToast('Appointment cancelled.');
      closeReservationModal();
      loadAppointments();
    }

    // Work Hours Modal
    function openWorkHoursModal() {
      document.getElementById('workHoursModal').classList.add('active');
    }

    function closeWorkHoursModal() {
      document.getElementById('workHoursModal').classList.remove('active');
    }

    // AI Reschedule Modal
    function openRescheduleModal(id, name, startTime) {
      activeRescheduleApptId = id;
      document.getElementById('modalPatientName').innerText = 'Patient: ' + name;
      document.getElementById('modalApptTime').innerText = 'Scheduled: ' + new Date(startTime).toLocaleString();
      document.getElementById('modalDoctorPrompt').value = '';
      document.getElementById('aiRescheduleModal').classList.add('active');
    }

    function closeRescheduleModal() {
      document.getElementById('aiRescheduleModal').classList.remove('active');
      activeRescheduleApptId = null;
    }

    function applyDirective(text) {
      document.getElementById('modalDoctorPrompt').value = text;
    }

    async function submitAiReschedule() {
      if (!activeRescheduleApptId) return;
      var promptText = document.getElementById('modalDoctorPrompt').value;
      var btn = document.getElementById('modalSubmitBtn');
      btn.innerText = 'Dispatching...';
      btn.disabled = true;

      try {
        var res = await fetch('/admin/api/appointments/' + activeRescheduleApptId + '/request-reschedule?key=' + adminKey, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ doctorPrompt: promptText })
        });
        var data = await res.json();
        closeRescheduleModal();

        if (data.success) {
          showToast('AI reschedule outreach sent to patient via WhatsApp.');
          loadAppointments();
        } else {
          alert('Error: ' + (data.error || 'Failed to trigger AI reschedule'));
        }
      } catch (err) {
        alert('Network error: ' + err.message);
      } finally {
        btn.innerText = 'Dispatch WhatsApp Request';
        btn.disabled = false;
      }
    }

    async function toggleDayOpen(day) {
      var rule = null;
      for (var i = 0; i < cachedRules.length; i++) {
        if (Number(cachedRules[i].day_of_week) === day) {
          rule = cachedRules[i];
          break;
        }
      }
      var newActive = rule ? !rule.is_active : true;
      var startTime = (rule && rule.start_time) ? rule.start_time : '09:00';
      var endTime = (rule && rule.end_time) ? rule.end_time : '17:00';

      if (rule) {
        rule.is_active = newActive;
      } else {
        cachedRules.push({ day_of_week: day, start_time: startTime, end_time: endTime, is_active: newActive });
      }

      var activeInput = document.getElementById('active-' + day);
      if (activeInput) activeInput.checked = newActive;

      var res = await fetch('/admin/api/availability/rules?key=' + adminKey, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          day_of_week: day,
          start_time: startTime,
          end_time: endTime,
          is_active: newActive
        })
      });
      if (res.ok) {
        showToast(newActive ? 'Day marked as bookable.' : 'Day marked as closed.');
        loadAvailability();
      }
    }

    async function applyPreset(type) {
      var days = [0, 1, 2, 3, 4, 5, 6];
      var rules = days.map(function(day) {
        var isActive = false;
        var start = '09:00';
        var end = '17:00';

        if (type === 'standard') {
          isActive = (day >= 1 && day <= 5);
          start = '09:00';
          end = '17:00';
        } else if (type === 'extended') {
          isActive = (day >= 1 && day <= 6);
          start = '08:00';
          end = '18:00';
        } else if (type === 'all') {
          isActive = true;
          start = '09:00';
          end = '18:00';
        }
        return {
          day_of_week: day,
          is_active: isActive,
          start_time: start,
          end_time: end
        };
      });

      var res = await fetch('/admin/api/availability/rules/batch?key=' + adminKey, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ rules: rules })
      });

      if (res.ok) {
        showToast('Applied ' + type.toUpperCase() + ' schedule preset.');
        loadAvailability();
      } else {
        alert('Failed to apply preset.');
      }
    }

    async function loadAppointments() {
      try {
        var res = await fetch('/admin/api/appointments?key=' + adminKey, { headers: headers });
        var data = await res.json();
        cachedAppointments = data.appointments || [];

        // Center on week of first upcoming appointment if current week has none
        if (cachedAppointments.length > 0) {
          var upcoming = cachedAppointments.filter(function(a) { return a.status !== 'cancelled'; });
          if (upcoming.length > 0) {
            upcoming.sort(function(x, y) { return new Date(x.start_time).getTime() - new Date(y.start_time).getTime(); });
            var hasInCurrentWeek = upcoming.some(function(a) {
              var d = new Date(a.start_time);
              var endWeek = new Date(currentWeekMonday);
              endWeek.setDate(endWeek.getDate() + 7);
              return d >= currentWeekMonday && d < endWeek;
            });
            if (!hasInCurrentWeek) {
              currentWeekMonday = getMonday(upcoming[0].start_time);
            }
          }
        }

        renderWeeklyGrid();
      } catch (e) {
        console.error(e);
      }
    }

    async function loadAvailability() {
      try {
        var res = await fetch('/admin/api/availability?key=' + adminKey, { headers: headers });
        var data = await res.json();
        var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        var rulesContainer = document.getElementById('weeklyRulesList');

        cachedRules = data.rules || [];
        renderWeeklyGrid();

        var rulesHtml = '';
        for (var rIdx = 0; rIdx < (data.rules || []).length; rIdx++) {
          var r = data.rules[rIdx];
          rulesHtml += '<div class="day-item" data-day="' + r.day_of_week + '">' +
            '<div style="font-weight: 500; font-size: 13px; color: #fff; width: 90px;">' + days[r.day_of_week] + '</div>' +
            '<label class="switch-wrap">' +
              '<div class="switch">' +
                '<input type="checkbox" id="active-' + r.day_of_week + '" ' + (r.is_active ? 'checked' : '') + '>' +
                '<span class="slider"></span>' +
              '</div>' +
              '<span style="font-size: 12px; color: ' + (r.is_active ? 'var(--emerald)' : 'var(--text-subtle)') + ';">' +
                (r.is_active ? 'Bookable' : 'Closed') +
              '</span>' +
            '</label>' +
            '<div style="display: flex; align-items: center; gap: 6px;">' +
              '<input type="time" id="start-' + r.day_of_week + '" value="' + r.start_time + '" style="width: 105px;">' +
              '<span style="font-size: 11px; color: var(--text-subtle);">to</span>' +
              '<input type="time" id="end-' + r.day_of_week + '" value="' + r.end_time + '" style="width: 105px;">' +
            '</div>' +
            '<button class="btn btn-secondary" style="padding: 4px 10px; font-size: 11.5px;" onclick="saveSingleDayHours(' + r.day_of_week + ')">Save</button>' +
          '</div>';
        }
        rulesContainer.innerHTML = rulesHtml;

        var tbody = document.querySelector('#overridesTable tbody');
        if (!data.overrides || data.overrides.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-subtle); padding: 14px;">No date blockouts configured.</td></tr>';
          return;
        }

        var overridesHtml = '';
        for (var oIdx = 0; oIdx < data.overrides.length; oIdx++) {
          var o = data.overrides[oIdx];
          overridesHtml += '<tr>' +
            '<td class="mono" style="font-weight: 500; color: #fff;">' + o.date + '</td>' +
            '<td><span class="badge badge-unpaid">' + (o.is_unavailable ? 'Full Day Off' : 'Custom Hours') + '</span></td>' +
            '<td style="color: var(--text-muted);">' + (o.reason || '-') + '</td>' +
            '<td><button class="btn btn-danger" style="padding: 2px 7px; font-size: 11px;" data-delete-override="' + o.id + '">✕</button></td>' +
          '</tr>';
        }
        tbody.innerHTML = overridesHtml;
      } catch (e) {
        console.error(e);
      }
    }

    async function saveSingleDayHours(day) {
      var isActive = document.getElementById('active-' + day).checked;
      var startTime = document.getElementById('start-' + day).value;
      var endTime = document.getElementById('end-' + day).value;

      var res = await fetch('/admin/api/availability/rules?key=' + adminKey, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          day_of_week: day,
          start_time: startTime,
          end_time: endTime,
          is_active: isActive
        })
      });
      if (res.ok) {
        showToast('Schedule updated.');
        loadAvailability();
      }
    }

    async function saveAllWeeklyHours() {
      var days = [0, 1, 2, 3, 4, 5, 6];
      var rules = days.map(function(day) {
        var checkbox = document.getElementById('active-' + day);
        var startInput = document.getElementById('start-' + day);
        var endInput = document.getElementById('end-' + day);
        return {
          day_of_week: day,
          is_active: checkbox ? checkbox.checked : true,
          start_time: startInput ? startInput.value : '09:00',
          end_time: endInput ? endInput.value : '17:00'
        };
      });

      var res = await fetch('/admin/api/availability/rules/batch?key=' + adminKey, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ rules: rules })
      });
      if (res.ok) {
        showToast('All weekly work hours saved.');
        loadAvailability();
      }
    }

    async function addOverride() {
      var date = document.getElementById('overrideDate').value;
      var reason = document.getElementById('overrideReason').value;
      if (!date) return alert('Please choose a date.');
      await fetch('/admin/api/availability/overrides?key=' + adminKey, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ date: date, is_unavailable: true, reason: reason })
      });
      showToast('Date blockout added.');
      loadAvailability();
    }

    async function deleteOverride(id) {
      await fetch('/admin/api/availability/overrides/' + id + '?key=' + adminKey, { method: 'DELETE', headers: headers });
      showToast('Date blockout removed.');
      loadAvailability();
    }

    // Drag and Drop for Working Hours Windows
    function showDragTooltip(x, y, text) {
      var tip = document.getElementById('dragTooltip');
      if (!tip) return;
      tip.innerText = text;
      tip.style.left = x + 'px';
      tip.style.top = (y - 14) + 'px';
      tip.style.display = 'block';
    }

    function hideDragTooltip() {
      var tip = document.getElementById('dragTooltip');
      if (tip) tip.style.display = 'none';
    }

    var activeDrag = null;

    document.addEventListener('pointerdown', function(e) {
      var handle = e.target.closest('[data-handle]');
      if (!handle) return;
      e.preventDefault();

      var type = handle.getAttribute('data-handle');
      var day = parseInt(handle.getAttribute('data-day'), 10);
      var rule = null;
      for (var r = 0; r < cachedRules.length; r++) {
        if (Number(cachedRules[r].day_of_week) === day) {
          rule = cachedRules[r];
          break;
        }
      }
      if (!rule) return;

      var blockElem = document.getElementById('availBlock-' + day);
      if (!blockElem) return;

      var startMins = timeToMinutes(rule.start_time);
      var endMins = timeToMinutes(rule.end_time);

      activeDrag = {
        type: type,
        day: day,
        rule: rule,
        startY: e.clientY,
        initialStartMins: startMins,
        initialEndMins: endMins,
        currentStartMins: startMins,
        currentEndMins: endMins,
        blockElem: blockElem
      };

      blockElem.classList.add('is-dragging');
      showDragTooltip(e.clientX, e.clientY, rule.start_time + ' - ' + rule.end_time);
    });

    document.addEventListener('pointermove', function(e) {
      if (!activeDrag) return;
      e.preventDefault();

      var deltaPx = e.clientY - activeDrag.startY;
      var deltaMins = Math.round((deltaPx / PX_PER_MIN) / 15) * 15;

      var newStart = activeDrag.initialStartMins;
      var newEnd = activeDrag.initialEndMins;

      if (activeDrag.type === 'top') {
        newStart = Math.max(START_HOUR * 60, Math.min(activeDrag.initialEndMins - 30, activeDrag.initialStartMins + deltaMins));
      } else if (activeDrag.type === 'bottom') {
        newEnd = Math.min(END_HOUR * 60, Math.max(activeDrag.initialStartMins + 30, activeDrag.initialEndMins + deltaMins));
      } else if (activeDrag.type === 'move') {
        var duration = activeDrag.initialEndMins - activeDrag.initialStartMins;
        newStart = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60 - duration, activeDrag.initialStartMins + deltaMins));
        newEnd = newStart + duration;
      }

      activeDrag.currentStartMins = newStart;
      activeDrag.currentEndMins = newEnd;

      var topY = minutesToY(newStart);
      var bottomY = minutesToY(newEnd);
      var height = Math.max(24, bottomY - topY);

      activeDrag.blockElem.style.top = topY + 'px';
      activeDrag.blockElem.style.height = height + 'px';

      var startTimeStr = minutesToTime(newStart);
      var endTimeStr = minutesToTime(newEnd);
      var labelElem = document.getElementById('blockLabel-' + activeDrag.day);
      if (labelElem) {
        labelElem.innerText = startTimeStr + ' - ' + endTimeStr;
      }

      showDragTooltip(e.clientX, e.clientY, startTimeStr + ' - ' + endTimeStr);
    });

    document.addEventListener('pointerup', async function(e) {
      if (!activeDrag) return;
      var drag = activeDrag;
      activeDrag = null;

      hideDragTooltip();
      drag.blockElem.classList.remove('is-dragging');

      var finalStart = minutesToTime(drag.currentStartMins);
      var finalEnd = minutesToTime(drag.currentEndMins);

      drag.rule.start_time = finalStart;
      drag.rule.end_time = finalEnd;

      var sInp = document.getElementById('start-' + drag.day);
      var eInp = document.getElementById('end-' + drag.day);
      if (sInp) sInp.value = finalStart;
      if (eInp) eInp.value = finalEnd;

      var dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      try {
        await fetch('/admin/api/availability/rules?key=' + adminKey, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            day_of_week: drag.day,
            start_time: finalStart,
            end_time: finalEnd,
            is_active: true
          })
        });
        showToast('Updated ' + dayNames[drag.day] + ' work hours: ' + finalStart + ' - ' + finalEnd);
        renderWeeklyGrid();
      } catch (err) {
        console.error(err);
      }
    });

    // Delegated click handler for meeting cards and table buttons
    document.addEventListener('click', function(e) {
      var card = e.target.closest('[data-appt-id]');
      if (card) {
        var apptId = card.getAttribute('data-appt-id');
        openReservationModal(apptId);
      }
      var delBtn = e.target.closest('[data-delete-override]');
      if (delBtn) {
        var oId = delBtn.getAttribute('data-delete-override');
        deleteOverride(oId);
      }
    });

    // Expose all functions to global window
    window.prevWeek = prevWeek;
    window.nextWeek = nextWeek;
    window.todayWeek = todayWeek;
    window.openWorkHoursModal = openWorkHoursModal;
    window.closeWorkHoursModal = closeWorkHoursModal;
    window.openReservationModal = openReservationModal;
    window.closeReservationModal = closeReservationModal;
    window.openRescheduleFromDetails = openRescheduleFromDetails;
    window.completeFromDetails = completeFromDetails;
    window.cancelFromDetails = cancelFromDetails;
    window.openRescheduleModal = openRescheduleModal;
    window.closeRescheduleModal = closeRescheduleModal;
    window.applyDirective = applyDirective;
    window.submitAiReschedule = submitAiReschedule;
    window.toggleDayOpen = toggleDayOpen;
    window.toggleHoursOverlay = toggleHoursOverlay;
    window.applyPreset = applyPreset;
    window.saveSingleDayHours = saveSingleDayHours;
    window.saveAllWeeklyHours = saveAllWeeklyHours;
    window.addOverride = addOverride;
    window.deleteOverride = deleteOverride;

    // Initial Load
    loadAppointments();
    loadAvailability();
  </script>
</body>
</html>`);
  });

  return router;
}
