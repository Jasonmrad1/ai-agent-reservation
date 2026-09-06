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
  <style>
    :root {
      --primary: #0284c7;
      --primary-hover: #0369a1;
      --bg: #f8fafc;
      --card: #ffffff;
      --text: #0f172a;
      --border: #e2e8f0;
      --success: #16a34a;
      --danger: #dc2626;
      --warning: #d97706;
      --purple: #7c3aed;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
    .container { max-width: 1100px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--border); padding-bottom: 16px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 24px; color: #0369a1; }
    .tabs { display: flex; gap: 8px; margin-bottom: 20px; }
    .tab-btn { padding: 10px 18px; border: 1px solid var(--border); background: white; border-radius: 6px; cursor: pointer; font-weight: 600; }
    .tab-btn.active { background: var(--primary); color: white; border-color: var(--primary); }
    .panel { display: none; background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .panel.active { display: block; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid var(--border); }
    th { background: #f1f5f9; font-size: 13px; text-transform: uppercase; color: #64748b; }
    .badge { padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; display: inline-block; }
    .badge-home { background: #fef3c7; color: #92400e; }
    .badge-office { background: #e0e7ff; color: #3730a3; }
    .badge-paid { background: #dcfce7; color: #166534; }
    .badge-unpaid { background: #fee2e2; color: #991b1b; }
    .badge-pending { background: #fef3c7; color: #b45309; }
    .badge-rescheduled { background: #f3e8ff; color: #6b21a8; }
    .btn { padding: 6px 12px; border-radius: 4px; border: none; cursor: pointer; font-weight: 500; font-size: 13px; display: inline-flex; align-items: center; gap: 4px; }
    .btn-primary { background: var(--primary); color: white; }
    .btn-success { background: var(--success); color: white; }
    .btn-danger { background: var(--danger); color: white; }
    .btn-warning { background: var(--warning); color: white; }
    .btn-purple { background: var(--purple); color: white; }
    .form-group { margin-bottom: 12px; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; }
    input, select, textarea { width: 100%; max-width: 320px; padding: 8px; border: 1px solid var(--border); border-radius: 4px; box-sizing: border-box; }
    .day-card { display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid var(--border); background: #fcfcfc; margin-bottom: 6px; border-radius: 6px; }
    .day-name { width: 120px; font-weight: 600; font-size: 15px; }
    .time-inputs { display: flex; align-items: center; gap: 8px; }
    .time-inputs input[type="time"] { width: 110px; padding: 6px; }
    .notification { padding: 12px; border-radius: 6px; margin-bottom: 16px; display: none; font-size: 14px; }
    .notif-success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Dr. Robert Smith Medical Practice</h1>
        <small style="color: #64748b;">WhatsApp Automation & Practice Admin Portal</small>
      </div>
      <div>
        <span id="authStatus" style="font-size: 13px; color: var(--success); font-weight: bold;">● System Connected</span>
      </div>
    </header>

    <div id="statusToast" class="notification notif-success"></div>

    <div class="tabs">
      <button class="tab-btn active" onclick="showTab('tab-appointments')">Upcoming Appointments</button>
      <button class="tab-btn" onclick="showTab('tab-availability')">Weekly Work Hours & Availability</button>
      <button class="tab-btn" onclick="showTab('tab-invoices')">Billing & Invoices</button>
      <button class="tab-btn" onclick="showTab('tab-alerts')">Alerts & Escalations</button>
    </div>

    <!-- Appointments Tab -->
    <div id="tab-appointments" class="panel active">
      <h2>Upcoming Appointments</h2>
      <p style="color: #64748b;">All visits booked via WhatsApp sync here and directly onto your iPhone Google Calendar.</p>
      <table id="appointmentsTable">
        <thead>
          <tr>
            <th>Patient</th>
            <th>Service</th>
            <th>Type</th>
            <th>Address / Details</th>
            <th>Date & Time</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr><td colspan="7">Loading appointments...</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Availability Tab -->
    <div id="tab-availability" class="panel">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h2>Weekly Work Hours</h2>
          <p style="color: #64748b;">Explicitly set which days and hours you are available for patients to book via WhatsApp.</p>
        </div>
        <button class="btn btn-success" style="padding: 10px 18px; font-size: 14px;" onclick="saveAllWeeklyHours()">💾 Save All Weekly Hours</button>
      </div>
      
      <div id="weeklyRulesList" style="margin-top: 16px;"></div>

      <h3 style="margin-top: 32px;">Vacation / Specific Date Overrides</h3>
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

      <h4 style="margin-top: 20px;">Add Vacation / Holiday Override</h4>
      <div style="display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap;">
        <div>
          <label>Date (YYYY-MM-DD)</label>
          <input type="date" id="overrideDate">
        </div>
        <div>
          <label>Reason</label>
          <input type="text" id="overrideReason" placeholder="e.g. Conference, Personal">
        </div>
        <button class="btn btn-primary" onclick="addOverride()">Add Override</button>
      </div>
    </div>

    <!-- Invoices Tab -->
    <div id="tab-invoices" class="panel">
      <h2>Invoices & Receipts</h2>
      <p style="color: #64748b;">Invoices generated from completed visits and sent to patients via WhatsApp.</p>
      <table id="invoicesTable">
        <thead>
          <tr>
            <th>Invoice ID</th>
            <th>Patient</th>
            <th>Service</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>

    <!-- Alerts Tab -->
    <div id="tab-alerts" class="panel">
      <h2>Alerts & Human Escalations</h2>
      <p style="color: #64748b;">Failed WhatsApp sends, handoff requests, and critical alerts requiring staff attention.</p>
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

  <script>
    const adminKey = "${key}";
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + adminKey
    };

    function showToast(msg) {
      const toast = document.getElementById('statusToast');
      toast.innerText = msg;
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 4000);
    }

    function showTab(tabId) {
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      event.target.classList.add('active');
    }

    async function loadAppointments() {
      const res = await fetch('/admin/api/appointments?key=' + adminKey, { headers });
      const data = await res.json();
      const tbody = document.querySelector('#appointmentsTable tbody');
      if (!data.appointments || data.appointments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">No upcoming appointments found.</td></tr>';
        return;
      }
      tbody.innerHTML = data.appointments.map(a => \`
        <tr>
          <td><strong>\${a.customer_name || 'Patient'}</strong><br><small>\${a.customer_phone}</small></td>
          <td>\${a.service}</td>
          <td><span class="badge \${a.visit_type === 'home_visit' ? 'badge-home' : 'badge-office'}">\${a.visit_type === 'home_visit' ? '🏠 Home Visit' : '🏥 In-Office'}</span></td>
          <td>\${a.address || 'Clinic'}\${a.notes ? '<br><small style="color: #6b21a8;">' + a.notes.substring(0, 70) + '...</small>' : ''}</td>
          <td>\${new Date(a.start_time).toLocaleString()}</td>
          <td><span class="badge \${a.status === 'rescheduled' ? 'badge-rescheduled' : 'badge-pending'}">\${a.status}</span></td>
          <td>
            <div style="display: flex; gap: 6px; flex-wrap: wrap;">
              \${a.status !== 'completed' && a.status !== 'cancelled' ? \`
                <button class="btn btn-purple" title="Prompt AI to negotiate new time with patient" onclick="promptAiReschedule('\${a.id}', '\${(a.customer_name || 'Patient').replace(/'/g, "\\\\'")}', '\${a.start_time}')">🤖 AI Reschedule</button>
                <button class="btn btn-success" onclick="completeAndBill('\${a.id}')">Complete & Bill</button>
              \` : a.status}
            </div>
          </td>
        </tr>
      \`).join('');
    }

    async function promptAiReschedule(id, name, currentStartTime) {
      const doctorPrompt = prompt(
        "🤖 Prompt AI to Reschedule with " + name + "\\n\\n" +
        "Current Appointment: " + new Date(currentStartTime).toLocaleString() + "\\n\\n" +
        "Enter instructions or reason for the AI (e.g. 'Emergency hospital call Tuesday morning, ask if Wednesday 2pm or Thursday 11am works'):"
      );
      if (doctorPrompt === null) return; // cancelled

      const res = await fetch('/admin/api/appointments/' + id + '/request-reschedule?key=' + adminKey, {
        method: 'POST',
        headers,
        body: JSON.stringify({ doctorPrompt })
      });
      const data = await res.json();
      if (data.success) {
        alert("✅ AI Outreach Sent to " + name + " via WhatsApp!\\n\\nMessage dispatched:\\n\\"" + data.messageSent + "\\"");
        showToast("AI reschedule message sent to patient.");
        loadAppointments();
      } else {
        alert("Error requesting AI reschedule: " + (data.error || "Unknown error"));
      }
    }

    async function completeAndBill(id) {
      if (!confirm('Mark appointment as completed and send bill to patient via WhatsApp?')) return;
      await fetch('/admin/api/appointments/' + id + '/complete?key=' + adminKey, { method: 'POST', headers });
      showToast("Appointment completed & invoice sent.");
      loadAppointments();
      loadInvoices();
    }

    async function loadInvoices() {
      const res = await fetch('/admin/api/invoices?key=' + adminKey, { headers });
      const data = await res.json();
      const tbody = document.querySelector('#invoicesTable tbody');
      if (!data.invoices || data.invoices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">No invoices created yet.</td></tr>';
        return;
      }
      tbody.innerHTML = data.invoices.map(i => \`
        <tr>
          <td>\${i.id.substring(0,8).toUpperCase()}</td>
          <td>\${i.customer_name || i.customer_phone}</td>
          <td>\${i.service_description}</td>
          <td>$\${i.amount.toFixed(2)} \${i.currency}</td>
          <td><span class="badge \${i.status === 'paid' ? 'badge-paid' : 'badge-unpaid'}">\${i.status}</span></td>
          <td>\${new Date(i.created_at).toLocaleDateString()}</td>
          <td>
            \${i.status === 'unpaid' ? \`<button class="btn btn-primary" onclick="markPaid('\${i.id}')">Mark Paid</button>\` : 'Paid'}
          </td>
        </tr>
      \`).join('');
    }

    async function markPaid(id) {
      await fetch('/admin/api/invoices/' + id + '/pay?key=' + adminKey, { method: 'POST', headers });
      showToast("Invoice marked paid and receipt sent to patient.");
      loadInvoices();
    }

    async function loadAlerts() {
      const res = await fetch('/admin/api/alerts?key=' + adminKey, { headers });
      const data = await res.json();
      const tbody = document.querySelector('#alertsTable tbody');
      if (!data.alerts || data.alerts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No alerts at this time. All systems operational.</td></tr>';
        return;
      }
      tbody.innerHTML = data.alerts.map(a => \`
        <tr>
          <td><span class="badge badge-pending">\${a.type}</span></td>
          <td><strong>\${a.title}</strong></td>
          <td>\${a.details}</td>
          <td>\${a.status}</td>
          <td>
            \${a.status === 'pending' ? \`<button class="btn btn-primary" onclick="resolveAlert('\${a.id}')">Resolve</button>\` : 'Resolved'}
          </td>
        </tr>
      \`).join('');
    }

    async function resolveAlert(id) {
      await fetch('/admin/api/alerts/' + id + '/resolve?key=' + adminKey, { method: 'POST', headers });
      loadAlerts();
    }

    async function loadAvailability() {
      const res = await fetch('/admin/api/availability?key=' + adminKey, { headers });
      const data = await res.json();
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const rulesContainer = document.getElementById('weeklyRulesList');

      // Build interactive table for doctor to set work hours explicitly
      rulesContainer.innerHTML = (data.rules || []).map(r => \`
        <div class="day-card" data-day="\${r.day_of_week}">
          <div class="day-name">\${days[r.day_of_week]}</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="active-\${r.day_of_week}" \${r.is_active ? 'checked' : ''} style="width: 18px; height: 18px;">
            <label for="active-\${r.day_of_week}" style="margin: 0; cursor: pointer;">Open for Appointments</label>
          </div>
          <div class="time-inputs">
            <span>From:</span>
            <input type="time" id="start-\${r.day_of_week}" value="\${r.start_time}">
            <span>To:</span>
            <input type="time" id="end-\${r.day_of_week}" value="\${r.end_time}">
          </div>
          <button class="btn btn-primary" onclick="saveSingleDayHours(\${r.day_of_week})">Save Day</button>
        </div>
      \`).join('');

      const tbody = document.querySelector('#overridesTable tbody');
      if (!data.overrides || data.overrides.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No date overrides configured.</td></tr>';
        return;
      }
      tbody.innerHTML = data.overrides.map(o => \`
        <tr>
          <td>\${o.date}</td>
          <td>\${o.is_unavailable ? 'Off / Closed' : 'Special Hours'}</td>
          <td>\${o.start_time || 'All Day'} - \${o.end_time || ''}</td>
          <td>\${o.reason || '-'}</td>
          <td><button class="btn btn-danger" onclick="deleteOverride('\${o.id}')">Remove</button></td>
        </tr>
      \`).join('');
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
        showToast("Work hours saved for day!");
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
