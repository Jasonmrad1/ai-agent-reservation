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
    const appointments = db.appointments.listUpcoming(50);
    res.json({ appointments });
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
      outreachMessage = `Hello ${customer.name || 'Patient'}, Dr. Smith needs to reschedule your ${appt.service} appointment originally scheduled for ${new Date(appt.start_time).toLocaleString()}${reasonText}.${slotText} Please reply with your preferred day and time!`;
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

  // 5. Admin Dashboard Web UI
  router.get('/dashboard', (req: Request, res: Response) => {
    const key = (req.query.key as string) || '';
    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Dr. Robert Smith - Practice Management Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #121212;
      --bg-surface: #181818;
      --bg-surface-elevated: #1e1e1e;
      --bg-surface-hover: #262626;
      --border: #2e2e2e;
      --border-focus: #3ecf8e;
      --emerald: #3ecf8e;
      --emerald-dark: #1e4e3b;
      --emerald-hover: #34b27b;
      --emerald-glow: rgba(62, 207, 142, 0.18);
      --text: #ededed;
      --text-muted: #9ca3af;
      --text-subtle: #71717a;
      --warning: #facc15;
      --warning-bg: rgba(234, 179, 8, 0.12);
      --warning-border: rgba(234, 179, 8, 0.28);
      --danger: #f87171;
      --danger-bg: rgba(239, 68, 68, 0.12);
      --purple: #c084fc;
      --purple-bg: rgba(192, 132, 252, 0.12);
      --cyan: #38bdf8;
      --cyan-bg: rgba(56, 189, 248, 0.12);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding-bottom: 60px;
    }
    .mono { font-family: 'JetBrains Mono', monospace; }
    
    /* Top Bar */
    .top-nav {
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border);
      padding: 14px 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 50;
      backdrop-filter: blur(8px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-logo {
      width: 34px;
      height: 34px;
      background: linear-gradient(135deg, #3ecf8e 0%, #1e4e3b 100%);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #121212;
      font-weight: 800;
      font-size: 18px;
      box-shadow: 0 0 12px var(--emerald-glow);
    }
    .brand-title { font-size: 16px; font-weight: 700; color: #fff; letter-spacing: -0.3px; }
    .brand-subtitle { font-size: 12px; color: var(--text-muted); }
    .status-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(62, 207, 142, 0.08);
      border: 1px solid rgba(62, 207, 142, 0.25);
      padding: 6px 12px;
      border-radius: 9999px;
      font-size: 12px;
      color: var(--emerald);
      font-weight: 600;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      background: var(--emerald);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--emerald);
      animation: pulse 2s infinite ease-in-out;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }

    /* Layout */
    .container { max-width: 1240px; margin: 28px auto; padding: 0 20px; }

    /* KPI Cards */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .kpi-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 18px 20px;
      position: relative;
      transition: border-color 0.2s, transform 0.2s;
    }
    .kpi-card:hover {
      border-color: #444;
      transform: translateY(-2px);
    }
    .kpi-title { font-size: 13px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi-value { font-size: 28px; font-weight: 700; color: #fff; margin: 6px 0 2px; }
    .kpi-sub { font-size: 12px; color: var(--text-subtle); display: flex; align-items: center; gap: 6px; }

    /* Tabs */
    .tabs-wrapper {
      display: flex;
      gap: 6px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      padding: 6px;
      border-radius: 10px;
      margin-bottom: 24px;
      overflow-x: auto;
    }
    .tab-btn {
      padding: 9px 18px;
      background: transparent;
      border: none;
      border-radius: 7px;
      color: var(--text-muted);
      cursor: pointer;
      font-weight: 600;
      font-size: 13.5px;
      transition: all 0.2s;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tab-btn:hover { color: #fff; background: rgba(255,255,255,0.04); }
    .tab-btn.active {
      background: var(--bg-surface-elevated);
      color: var(--emerald);
      box-shadow: 0 1px 3px rgba(0,0,0,0.5);
      border: 1px solid rgba(62, 207, 142, 0.3);
    }

    /* Panels */
    .panel { display: none; }
    .panel.active { display: block; animation: fadeIn 0.2s ease-in-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      margin-bottom: 24px;
    }
    .card-header {
      padding: 18px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--bg-surface-elevated);
    }
    .card-header h2 { font-size: 17px; font-weight: 700; color: #fff; }
    .card-header p { font-size: 13px; color: var(--text-muted); margin-top: 2px; }
    .card-body { padding: 20px 24px; }

    /* Tables */
    .table-container { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th {
      background: #141414;
      padding: 12px 18px;
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-subtle);
      border-bottom: 1px solid var(--border);
      font-weight: 700;
    }
    td {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      font-size: 13.5px;
      color: #e5e5e5;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--bg-surface-elevated); }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 600;
      letter-spacing: 0.2px;
    }
    .badge-home { background: var(--cyan-bg); color: var(--cyan); border: 1px solid rgba(56, 189, 248, 0.25); }
    .badge-office { background: rgba(255,255,255,0.06); color: #d4d4d8; border: 1px solid var(--border); }
    .badge-paid { background: rgba(62, 207, 142, 0.12); color: var(--emerald); border: 1px solid rgba(62, 207, 142, 0.25); }
    .badge-unpaid { background: var(--danger-bg); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.25); }
    .badge-pending { background: var(--warning-bg); color: var(--warning); border: 1px solid var(--warning-border); }
    .badge-rescheduled { background: var(--purple-bg); color: var(--purple); border: 1px solid rgba(192, 132, 252, 0.25); }

    /* Buttons */
    .btn {
      padding: 7px 14px;
      border-radius: 6px;
      border: 1px solid transparent;
      cursor: pointer;
      font-weight: 600;
      font-size: 12.5px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .btn:hover { transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }
    .btn-emerald {
      background: var(--emerald);
      color: #0b1e16;
      box-shadow: 0 0 10px var(--emerald-glow);
    }
    .btn-emerald:hover { background: var(--emerald-hover); }
    .btn-secondary {
      background: #27272a;
      border-color: #3f3f46;
      color: #ededed;
    }
    .btn-secondary:hover { background: #323238; }
    .btn-danger {
      background: var(--danger-bg);
      border-color: rgba(239, 68, 68, 0.3);
      color: var(--danger);
    }
    .btn-danger:hover { background: rgba(239, 68, 68, 0.2); }
    .btn-purple {
      background: var(--purple-bg);
      border-color: rgba(192, 132, 252, 0.3);
      color: var(--purple);
    }
    .btn-purple:hover { background: rgba(192, 132, 252, 0.2); }

    /* Inputs */
    input[type="text"], input[type="date"], input[type="time"], textarea, select {
      background: #141414;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: #ededed;
      padding: 8px 12px;
      font-size: 13px;
      font-family: inherit;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    input:focus, textarea:focus, select:focus {
      outline: none;
      border-color: var(--emerald);
      box-shadow: 0 0 0 1px var(--emerald);
    }

    /* Day Schedule Cards */
    .day-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      background: var(--bg-surface-elevated);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 10px;
      transition: border-color 0.2s;
    }
    .day-item:hover { border-color: #3f3f46; }
    .day-meta { width: 140px; font-weight: 700; font-size: 15px; color: #fff; }
    
    /* Toggle Switch */
    .switch-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
    }
    .switch {
      position: relative;
      display: inline-block;
      width: 42px;
      height: 24px;
    }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: #27272a;
      transition: .25s;
      border-radius: 24px;
      border: 1px solid #3f3f46;
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: #a1a1aa;
      transition: .25s;
      border-radius: 50%;
    }
    input:checked + .slider {
      background-color: var(--emerald-dark);
      border-color: var(--emerald);
    }
    input:checked + .slider:before {
      transform: translateX(18px);
      background-color: var(--emerald);
      box-shadow: 0 0 8px var(--emerald);
    }

    /* Toast */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 100;
    }
    .toast {
      background: #181818;
      border: 1px solid var(--emerald);
      box-shadow: 0 8px 30px rgba(0,0,0,0.6), 0 0 15px var(--emerald-glow);
      color: #fff;
      padding: 14px 20px;
      border-radius: 8px;
      font-size: 13.5px;
      display: none;
      align-items: center;
      gap: 12px;
      animation: slideUp 0.25s ease-out;
    }
    @keyframes slideUp { from { transform: translateY(15px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

    /* Supabase Modal */
    .modal-backdrop {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.75);
      backdrop-filter: blur(4px);
      z-index: 99;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .modal-backdrop.active { display: flex; }
    .modal-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      width: 100%;
      max-width: 520px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.8), 0 0 25px var(--emerald-glow);
      overflow: hidden;
      animation: popIn 0.2s ease-out;
    }
    @keyframes popIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    .modal-header {
      padding: 16px 22px;
      background: var(--bg-surface-elevated);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .modal-header h3 { font-size: 16px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }
    .modal-body { padding: 22px; }
    .modal-footer {
      padding: 14px 22px;
      background: var(--bg-surface-elevated);
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    .chip-group { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 16px; }
    .chip {
      background: #27272a;
      border: 1px solid #3f3f46;
      color: var(--text-muted);
      border-radius: 20px;
      padding: 4px 10px;
      font-size: 11.5px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .chip:hover { color: var(--emerald); border-color: var(--emerald); background: var(--emerald-dark); }
  </style>
</head>
<body>
  <!-- Top Navigation Bar -->
  <div class="top-nav">
    <div class="brand">
      <div class="brand-logo">⚡</div>
      <div>
        <div class="brand-title">Dr. Robert Smith Medical Practice</div>
        <div class="brand-subtitle">WhatsApp Autonomous Scheduling Engine</div>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 14px;">
      <div class="status-pill">
        <span class="pulse-dot"></span>
        <span>AI Engine Active</span>
      </div>
      <a href="/health" target="_blank" style="text-decoration: none;">
        <button class="btn btn-secondary" style="font-size: 11.5px;">Health API</button>
      </a>
    </div>
  </div>

  <div class="container">
    <!-- Top KPI Grid (Supabase style) -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-title">Upcoming Appointments</div>
        <div class="kpi-value" id="kpiApptsCount">-</div>
        <div class="kpi-sub" id="kpiApptsBreakdown">Synced with iOS Google Calendar</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Weekly Work Hours</div>
        <div class="kpi-value" id="kpiDaysOpen" style="color: var(--emerald);">-</div>
        <div class="kpi-sub">Active bookable schedule days</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Billing & Revenue</div>
        <div class="kpi-value" id="kpiRevenueSum" style="color: #6ee7b7;">-</div>
        <div class="kpi-sub" id="kpiInvoicesUnpaid">Generated via WhatsApp</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Escalations & Alerts</div>
        <div class="kpi-value" id="kpiAlertsCount">-</div>
        <div class="kpi-sub" id="kpiAlertsSub">Zero delivery failures</div>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="tabs-wrapper">
      <button class="tab-btn active" onclick="showTab('tab-appointments')">📅 Upcoming Appointments</button>
      <button class="tab-btn" onclick="showTab('tab-availability')">🕒 Weekly Work Hours & Availability</button>
      <button class="tab-btn" onclick="showTab('tab-invoices')">💳 Billing & Invoices</button>
      <button class="tab-btn" onclick="showTab('tab-alerts')">🚨 Alerts & Human Escalations</button>
    </div>

    <!-- Tab 1: Appointments -->
    <div id="tab-appointments" class="panel active">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Upcoming Appointments</h2>
            <p>Direct bookings and reschedules from WhatsApp. Fully synced with your Google Calendar.</p>
          </div>
          <button class="btn btn-secondary" onclick="loadAppointments()">↻ Refresh</button>
        </div>
        <div class="table-container">
          <table id="appointmentsTable">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Service</th>
                <th>Visit Type</th>
                <th>Address / Location</th>
                <th>Schedule</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Loading appointments...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Tab 2: Weekly Work Hours & Availability -->
    <div id="tab-availability" class="panel">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Weekly Work Hours</h2>
            <p>Explicitly set which days and hours you are available for patients to book via WhatsApp.</p>
          </div>
          <button class="btn btn-emerald" onclick="saveAllWeeklyHours()">💾 Save All Weekly Hours</button>
        </div>
        <div class="card-body">
          <div id="weeklyRulesList"></div>
        </div>
      </div>

      <!-- Vacation Overrides -->
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Vacation & Date Overrides</h2>
            <p>Block out specific days (holidays, conferences) or set one-off custom hours.</p>
          </div>
        </div>
        <div class="table-container">
          <table id="overridesTable">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>Hours</th>
                <th>Reason</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="card-body" style="border-top: 1px solid var(--border); background: var(--bg-surface-elevated);">
          <div style="font-size: 13.5px; font-weight: 700; margin-bottom: 12px; color: #fff;">Add New Date Override</div>
          <div style="display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap;">
            <div>
              <label style="font-size: 12px; color: var(--text-muted); display: block; margin-bottom: 4px;">Date (YYYY-MM-DD)</label>
              <input type="date" id="overrideDate" style="width: 180px;">
            </div>
            <div>
              <label style="font-size: 12px; color: var(--text-muted); display: block; margin-bottom: 4px;">Reason / Notes</label>
              <input type="text" id="overrideReason" placeholder="e.g. Medical Symposium, Personal" style="width: 280px;">
            </div>
            <button class="btn btn-emerald" onclick="addOverride()">+ Add Blockout</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 3: Billing & Invoices -->
    <div id="tab-invoices" class="panel">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Invoices & Receipts</h2>
            <p>Generated strictly from completed visits and delivered instantly to patients on WhatsApp.</p>
          </div>
          <button class="btn btn-secondary" onclick="loadInvoices()">↻ Refresh</button>
        </div>
        <div class="table-container">
          <table id="invoicesTable">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Patient</th>
                <th>Service</th>
                <th>Total Fee</th>
                <th>Payment Status</th>
                <th>Date Issued</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Tab 4: Alerts & Human Escalations -->
    <div id="tab-alerts" class="panel">
      <div class="card">
        <div class="card-header">
          <div>
            <h2>Alerts & Human Escalations</h2>
            <p>Delivery tracking failures, opt-outs, and patient requests for staff assistance.</p>
          </div>
          <button class="btn btn-secondary" onclick="loadAlerts()">↻ Refresh</button>
        </div>
        <div class="table-container">
          <table id="alertsTable">
            <thead>
              <tr>
                <th>Type</th>
                <th>Title</th>
                <th>Details</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- Supabase Styled AI Reschedule Modal Dialog -->
  <div id="aiRescheduleModal" class="modal-backdrop">
    <div class="modal-card">
      <div class="modal-header">
        <h3><span>🤖</span> Prompt AI to Reschedule</h3>
        <button onclick="closeRescheduleModal()" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 18px;">✕</button>
      </div>
      <div class="modal-body">
        <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 16px;">
          <div style="font-size: 14px; font-weight: 700; color: #fff;" id="modalPatientName">-</div>
          <div style="font-size: 12.5px; color: var(--text-muted); margin-top: 2px;" id="modalApptTime">-</div>
        </div>
        
        <label style="font-size: 12.5px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 6px;">
          Doctor's Directive / Reason for Rescheduling:
        </label>
        
        <div class="chip-group">
          <span class="chip" onclick="applyDirective('Hospital surgery emergency, please pick another day')">+ Hospital Emergency</span>
          <span class="chip" onclick="applyDirective('Doctor unavailable on this morning, suggest afternoon slots')">+ Morning Conflict</span>
          <span class="chip" onclick="applyDirective('Suggest Wednesday 2pm or Thursday 11am')">+ Offer Wed / Thu</span>
        </div>

        <textarea id="modalDoctorPrompt" rows="3" style="width: 100%; max-width: 100%;" placeholder="e.g. Doctor called into urgent surgery on Tuesday morning. Ask if Wednesday afternoon or Thursday works for them."></textarea>
        <p style="font-size: 11.5px; color: var(--text-subtle); margin-top: 6px;">
          ⚡ Gemini will generate a warm, polite WhatsApp message with open slots and dispatch it directly to the patient.
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeRescheduleModal()">Cancel</button>
        <button class="btn btn-emerald" id="modalSubmitBtn" onclick="submitAiReschedule()">
          <span>🚀 Dispatch AI WhatsApp</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Toast Notification -->
  <div class="toast-container">
    <div id="statusToast" class="toast">
      <span style="color: var(--emerald); font-size: 18px;">✔</span>
      <span id="toastMessage">Success</span>
    </div>
  </div>

  <script>
    const adminKey = "${key}";
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + adminKey
    };

    let activeRescheduleApptId = null;

    function showToast(msg) {
      const toast = document.getElementById('statusToast');
      const msgElem = document.getElementById('toastMessage');
      msgElem.innerText = msg;
      toast.style.display = 'flex';
      setTimeout(() => { toast.style.display = 'none'; }, 4000);
    }

    function showTab(tabId) {
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      event.target.classList.add('active');
    }

    async function loadAppointments() {
      try {
        const res = await fetch('/admin/api/appointments?key=' + adminKey, { headers });
        const data = await res.json();
        const tbody = document.querySelector('#appointmentsTable tbody');
        
        let homeCount = 0;
        let officeCount = 0;

        if (!data.appointments || data.appointments.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 32px;">No appointments found.</td></tr>';
          document.getElementById('kpiApptsCount').innerText = '0';
          return;
        }

        data.appointments.forEach(a => {
          if (a.visit_type === 'home_visit') homeCount++; else officeCount++;
        });

        document.getElementById('kpiApptsCount').innerText = data.appointments.length;
        document.getElementById('kpiApptsBreakdown').innerText = \`\${officeCount} In-Office • \${homeCount} Home Visits\`;

        tbody.innerHTML = data.appointments.map(a => \`
          <tr>
            <td>
              <strong style="color: #fff;">\${a.customer_name || 'Patient'}</strong>
              <div class="mono" style="font-size: 12px; color: var(--text-muted);">\${a.customer_phone}</div>
            </td>
            <td><strong>\${a.service}</strong></td>
            <td>
              <span class="badge \${a.visit_type === 'home_visit' ? 'badge-home' : 'badge-office'}">
                \${a.visit_type === 'home_visit' ? '🏠 Home Visit' : '🏥 In-Office'}
              </span>
            </td>
            <td>
              <div style="font-size: 13px;">\${a.address || '<span style="color: var(--text-subtle);">Clinic Office</span>'}</div>
              \${a.notes ? '<div style="font-size: 11.5px; color: var(--purple); margin-top: 3px;">📝 ' + a.notes.substring(0, 60) + '...</div>' : ''}
            </td>
            <td>
              <div style="font-weight: 600; color: #fff;">\${new Date(a.start_time).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
              <div class="mono" style="font-size: 12px; color: var(--text-muted);">\${new Date(a.start_time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
            </td>
            <td>
              <span class="badge \${
                a.status === 'confirmed' ? 'badge-paid' :
                a.status === 'rescheduled' ? 'badge-rescheduled' :
                a.status === 'completed' ? 'badge-paid' :
                a.status === 'cancelled' ? 'badge-unpaid' : 'badge-pending'
              }">\${a.status.toUpperCase()}</span>
            </td>
            <td>
              <div style="display: flex; gap: 8px;">
                \${a.status !== 'completed' && a.status !== 'cancelled' ? \`
                  <button class="btn btn-purple" onclick="openRescheduleModal('\${a.id}', '\${(a.customer_name || 'Patient').replace(/'/g, "\\\\'")}', '\${a.start_time}')">🤖 AI Reschedule</button>
                  <button class="btn btn-emerald" onclick="completeAndBill('\${a.id}')">Complete & Bill</button>
                \` : '<span style="color: var(--text-subtle); font-size: 12px;">Archived</span>'}
              </div>
            </td>
          </tr>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

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
      const promptText = document.getElementById('modalDoctorPrompt').value;
      const btn = document.getElementById('modalSubmitBtn');
      btn.innerText = 'Sending...';
      btn.disabled = true;

      try {
        const res = await fetch('/admin/api/appointments/' + activeRescheduleApptId + '/request-reschedule?key=' + adminKey, {
          method: 'POST',
          headers,
          body: JSON.stringify({ doctorPrompt: promptText })
        });
        const data = await res.json();
        closeRescheduleModal();

        if (data.success) {
          showToast("AI reschedule outreach sent to patient via WhatsApp!");
          loadAppointments();
        } else {
          alert("Error: " + (data.error || "Failed to trigger AI reschedule"));
        }
      } catch (err) {
        alert("Network error: " + err.message);
      } finally {
        btn.innerText = '🚀 Dispatch AI WhatsApp';
        btn.disabled = false;
      }
    }

    async function completeAndBill(id) {
      if (!confirm('Mark visit as completed and dispatch invoice to patient on WhatsApp?')) return;
      await fetch('/admin/api/appointments/' + id + '/complete?key=' + adminKey, { method: 'POST', headers });
      showToast("Appointment completed & invoice sent.");
      loadAppointments();
      loadInvoices();
    }

    async function loadInvoices() {
      try {
        const res = await fetch('/admin/api/invoices?key=' + adminKey, { headers });
        const data = await res.json();
        const tbody = document.querySelector('#invoicesTable tbody');

        let totalRev = 0;
        let unpaidCount = 0;

        if (!data.invoices || data.invoices.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 32px;">No invoices generated yet.</td></tr>';
          document.getElementById('kpiRevenueSum').innerText = '$0.00';
          document.getElementById('kpiInvoicesUnpaid').innerText = '0 Unpaid Invoices';
          return;
        }

        data.invoices.forEach(i => {
          totalRev += Number(i.amount);
          if (i.status === 'unpaid') unpaidCount++;
        });

        document.getElementById('kpiRevenueSum').innerText = '$' + totalRev.toFixed(2);
        document.getElementById('kpiInvoicesUnpaid').innerText = \`\${unpaidCount} Pending / Unpaid\`;

        tbody.innerHTML = data.invoices.map(i => \`
          <tr>
            <td><span class="mono" style="color: var(--emerald); font-weight: 600;">\${i.id.substring(0,8).toUpperCase()}</span></td>
            <td><strong>\${i.customer_name || i.customer_phone}</strong></td>
            <td>\${i.service_description}</td>
            <td class="mono" style="font-weight: 700; color: #fff;">$\${Number(i.amount).toFixed(2)} \${i.currency}</td>
            <td><span class="badge \${i.status === 'paid' ? 'badge-paid' : 'badge-unpaid'}">\${i.status.toUpperCase()}</span></td>
            <td>\${new Date(i.created_at).toLocaleDateString()}</td>
            <td>
              \${i.status === 'unpaid' ? \`<button class="btn btn-emerald" onclick="markPaid('\${i.id}')">Mark Paid</button>\` : '<span style="color: var(--emerald); font-size: 13px;">✔ Settled</span>'}
            </td>
          </tr>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function markPaid(id) {
      await fetch('/admin/api/invoices/' + id + '/pay?key=' + adminKey, { method: 'POST', headers });
      showToast("Payment recorded. WhatsApp confirmation receipt dispatched.");
      loadInvoices();
    }

    async function loadAlerts() {
      try {
        const res = await fetch('/admin/api/alerts?key=' + adminKey, { headers });
        const data = await res.json();
        const tbody = document.querySelector('#alertsTable tbody');

        const pending = (data.alerts || []).filter(a => a.status === 'pending');
        document.getElementById('kpiAlertsCount').innerText = pending.length;
        document.getElementById('kpiAlertsSub').innerText = pending.length === 0 ? 'All systems nominal' : \`\${pending.length} require review\`;

        if (!data.alerts || data.alerts.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 32px;">No alerts. System running smoothly.</td></tr>';
          return;
        }

        tbody.innerHTML = data.alerts.map(a => \`
          <tr>
            <td><span class="badge badge-pending">\${a.type}</span></td>
            <td><strong>\${a.title}</strong></td>
            <td style="color: var(--text-muted); font-size: 13px;">\${a.details}</td>
            <td><span class="badge \${a.status === 'resolved' ? 'badge-paid' : 'badge-unpaid'}">\${a.status}</span></td>
            <td>
              \${a.status === 'pending' ? \`<button class="btn btn-secondary" onclick="resolveAlert('\${a.id}')">Resolve</button>\` : 'Resolved'}
            </td>
          </tr>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function resolveAlert(id) {
      await fetch('/admin/api/alerts/' + id + '/resolve?key=' + adminKey, { method: 'POST', headers });
      showToast("Alert resolved.");
      loadAlerts();
    }

    async function loadAvailability() {
      try {
        const res = await fetch('/admin/api/availability?key=' + adminKey, { headers });
        const data = await res.json();
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const rulesContainer = document.getElementById('weeklyRulesList');

        const activeDaysCount = (data.rules || []).filter(r => r.is_active).length;
        document.getElementById('kpiDaysOpen').innerText = activeDaysCount + ' / 7 Days';

        rulesContainer.innerHTML = (data.rules || []).map(r => \`
          <div class="day-item" data-day="\${r.day_of_week}">
            <div class="day-meta">\${days[r.day_of_week]}</div>
            
            <label class="switch-wrap">
              <div class="switch">
                <input type="checkbox" id="active-\${r.day_of_week}" \${r.is_active ? 'checked' : ''}>
                <span class="slider"></span>
              </div>
              <span style="font-size: 13px; font-weight: 600; color: \${r.is_active ? 'var(--emerald)' : 'var(--text-subtle)'};">
                \${r.is_active ? 'Bookable' : 'Closed'}
              </span>
            </label>

            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 12px; color: var(--text-muted);">From</span>
              <input type="time" id="start-\${r.day_of_week}" value="\${r.start_time}" style="width: 120px;">
              <span style="font-size: 12px; color: var(--text-muted);">To</span>
              <input type="time" id="end-\${r.day_of_week}" value="\${r.end_time}" style="width: 120px;">
            </div>

            <button class="btn btn-secondary" onclick="saveSingleDayHours(\${r.day_of_week})">Save Day</button>
          </div>
        \`).join('');

        const tbody = document.querySelector('#overridesTable tbody');
        if (!data.overrides || data.overrides.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">No date blockouts configured.</td></tr>';
          return;
        }
        tbody.innerHTML = data.overrides.map(o => \`
          <tr>
            <td class="mono" style="font-weight: 600; color: #fff;">\${o.date}</td>
            <td><span class="badge badge-unpaid">\${o.is_unavailable ? 'Full Day Off' : 'Custom Hours'}</span></td>
            <td>\${o.start_time || 'All Day'} \${o.end_time ? ' - ' + o.end_time : ''}</td>
            <td style="color: var(--text-muted);">\${o.reason || '-'}</td>
            <td><button class="btn btn-danger" onclick="deleteOverride('\${o.id}')">Remove</button></td>
          </tr>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function saveSingleDayHours(day) {
      const isActive = document.getElementById('active-' + day).checked;
      const startTime = document.getElementById('start-' + day).value;
      const endTime = document.getElementById('end-' + day).value;

      const res = await fetch('/admin/api/availability/rules?key=' + adminKey, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          day_of_week: day,
          start_time: startTime,
          end_time: endTime,
          is_active: isActive
        })
      });
      if (res.ok) {
        showToast("Day schedule updated.");
        loadAvailability();
      } else {
        alert("Failed to save work hours.");
      }
    }

    async function saveAllWeeklyHours() {
      const days = [0, 1, 2, 3, 4, 5, 6];
      const rules = days.map(day => {
        const checkbox = document.getElementById('active-' + day);
        const startInput = document.getElementById('start-' + day);
        const endInput = document.getElementById('end-' + day);
        return {
          day_of_week: day,
          is_active: checkbox ? checkbox.checked : true,
          start_time: startInput ? startInput.value : '09:00',
          end_time: endInput ? endInput.value : '17:00',
        };
      });

      const res = await fetch('/admin/api/availability/rules/batch?key=' + adminKey, {
        method: 'POST',
        headers,
        body: JSON.stringify({ rules })
      });
      if (res.ok) {
        showToast("✅ All weekly work hours saved successfully!");
        loadAvailability();
      } else {
        alert("Failed to save all weekly hours.");
      }
    }

    async function addOverride() {
      const date = document.getElementById('overrideDate').value;
      const reason = document.getElementById('overrideReason').value;
      if (!date) return alert('Please choose a date.');
      await fetch('/admin/api/availability/overrides?key=' + adminKey, {
        method: 'POST',
        headers,
        body: JSON.stringify({ date, is_unavailable: true, reason })
      });
      showToast("Date override added.");
      loadAvailability();
    }

    async function deleteOverride(id) {
      await fetch('/admin/api/availability/overrides/' + id + '?key=' + adminKey, { method: 'DELETE', headers });
      showToast("Date override removed.");
      loadAvailability();
    }

    // Initial Load
    loadAppointments();
    loadAvailability();
    loadInvoices();
    loadAlerts();
  </script>
</body>
</html>`);
  });

  return router;
}
