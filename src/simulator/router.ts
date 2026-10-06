import {isUrgentMessage} from '../security/urgent.js';
import crypto from 'node:crypto';
import { Router, Request, Response } from 'express';
import { DatabaseContext } from '../db/index.js';
import { AgentCore } from '../gemini/index.js';
import { ReminderRunner } from '../reminders/runner.js';
import { validateInboundMessage, resetRateLimit } from '../security/guardrails.js';

export type GeminiSchedulingAgent = AgentCore;

export interface SimulatorRouterOptions {
  db: DatabaseContext;
  agent: AgentCore;
  reminders?: ReminderRunner;
}

export function createSimulatorRouter(options: SimulatorRouterOptions): Router {
  const router = Router();
  const { db, agent, reminders } = options;

  function normalizePhone(raw: string): string {
    let clean = (raw || '').trim();
    if (!clean) clean = '+96171476193';
    if (!clean.startsWith('whatsapp:') && !clean.startsWith('+')) {
      clean = clean.startsWith('961') ? `+${clean}` : `+961${clean.replace(/^0+/, '')}`;
    }
    return clean;
  }

  /**
   * GET /api/simulator/history
   * Retrieves message transcript and patient status for a phone number
   */
  router.get('/history', (req: Request, res: Response) => {
    try {
      const phone = normalizePhone(req.query.phone as string);
      const customer = db.customers.findByPhone(phone);
      if (!customer) {
        return res.json({ customer: null, conversation: null, messages: [], appointments: [] });
      }

      const conversation = db.conversations.findActiveByCustomerId(customer.id);
      const messages = conversation ? db.messages.getRecentMessages(conversation.id, 50) : [];
      const appointments = db.appointments.findUpcomingByCustomerId(customer.id);

      return res.json({
        customer,
        conversation,
        messages,
        appointments,
      });
    } catch (err: any) {
      console.error('[router] Operation requires review');
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/simulator/message
   * Simulates an incoming patient WhatsApp text without sending anything through Twilio
   */
  router.post('/message', async (req: Request, res: Response) => {
    try {
      const { phone: rawPhone, name, text } = req.body || {};
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text message is required' });
      }

      const fromPhone = normalizePhone(rawPhone);
      const profileName = (name || 'Test Patient').trim();
      const incomingText = text.trim();

      console.log('[router] Operation recorded');

      // 1. Customer & Conversation Resolution
      const customer = db.customers.findOrCreate(fromPhone, profileName);
      const conversation = db.conversations.getOrCreateActive(customer.id);
      db.conversations.touch(conversation.id);

      // 2. Audit log inbound message
      db.messages.create(
        conversation.id,
        'inbound',
        incomingText,
        'SIM_IN_' + crypto.randomUUID(),
        'received',
        { simulated: true }
      );

      // 3. Check Testing Reset Command (#reset / /reset / #clear)
      const lower = incomingText.toLowerCase();
      const command=incomingText.toUpperCase();
      if(['STOP','STOPALL','UNSUBSCRIBE','QUIT','OPTOUT','START','UNSTOP'].includes(command)) {
        const optedOut=!['START','UNSTOP'].includes(command);
        db.customers.setOptOut(customer.id,optedOut);customer.opted_out=optedOut;
        const reply=optedOut ? 'You have been unsubscribed. Reply START to resume clinic messages.' : 'Clinic messages have resumed. How can we help you?';
        db.messages.create(conversation.id,'outbound',reply,'SIM_OUT_'+crypto.randomUUID(),'sent');
        return res.json({reply,customer,conversationId:conversation.id,appointments:db.appointments.findUpcomingByCustomerId(customer.id)});
      }
      if(customer.opted_out) return res.json({reply:'',customer,conversationId:conversation.id,appointments:db.appointments.findUpcomingByCustomerId(customer.id)});
      if (lower === '#reset' || lower === '/reset' || lower === '#clear' || lower === '/clear') {
        console.log('[router] Operation recorded');
        const activeAppts = db.appointments.findUpcomingByCustomerId(customer.id, customer.phone);
        for (const appt of activeAppts) {
          if (agent && agent['scheduler']) {
            try {
              await agent['scheduler'].cancelAppointment(appt.id, 'Test reset');
            } catch {
              db.appointments.updateStatus(appt.id, 'cancelled');
            }
          } else {
            db.appointments.updateStatus(appt.id, 'cancelled');
          }
        }
        if (db.workflows) {
          const wf = db.workflows.findActiveByCustomerId(customer.id);
          if (wf) {
            db.workflows.transition(wf.id, 'expired');
          }
        }
        db.conversations.updateStatus(conversation.id, 'closed');
        resetRateLimit(fromPhone);

        const resetReply = '🔄 Session Reset Complete!\nYour conversation history and active test booking have been cleared. You can now test a brand new booking from scratch.\n\nتمت إعادة ضبط المحادثة وحالة الحجز بنجاح. يمكنك الآن تجربة حجز جديد.';
        db.messages.create(conversation.id, 'outbound', resetReply, 'SIM_OUT_' + crypto.randomUUID(), 'sent');

        return res.json({
          reply: resetReply,
          customer,
          conversationId: conversation.id,
          appointments: [],
          reset: true,
        });
      }

      if(lower==='/resume bot') {
        db.conversations.updateStatus(conversation.id,'active');
        return res.json({reply:'',customer,conversationId:conversation.id,appointments:db.appointments.findUpcomingByCustomerId(customer.id)});
      }
      if(['doctor_active','escalated'].includes(conversation.status) && !isUrgentMessage(incomingText)) {
        return res.json({reply:'',customer,conversationId:conversation.id,appointments:db.appointments.findUpcomingByCustomerId(customer.id)});
      }

      // 4. Security & Guardrails Check (0 tokens)
      const guardrail = isUrgentMessage(incomingText) ? {allowed:true,reply:undefined,reason:undefined} : validateInboundMessage(incomingText, fromPhone);
      if (!guardrail.allowed && guardrail.reply) {
        db.messages.create(conversation.id, 'outbound', guardrail.reply, 'SIM_OUT_' + crypto.randomUUID(), 'sent');
        return res.json({
          reply: guardrail.reply,
          customer,
          conversationId: conversation.id,
          guardrailTriggered: true,
          reason: guardrail.reason,
        });
      }

      // 5. Interactive Reminder Confirmation Check
      if (reminders) {
        const confirmationReply = await reminders.handleConfirmationResponse(customer.id, incomingText);
        if (confirmationReply) {
          db.messages.create(conversation.id, 'outbound', confirmationReply, 'SIM_OUT_' + crypto.randomUUID(), 'sent');
          return res.json({
            reply: confirmationReply,
            customer,
            conversationId: conversation.id,
            appointments: db.appointments.findUpcomingByCustomerId(customer.id),
          });
        }
      }

      // 6. Gemini Agent Execution
      const replyText = await agent.processMessage({
        customer,
        conversation,
        incomingText,
        db,
      });

      // 7. Store outbound reply in message history
      db.messages.create(conversation.id, 'outbound', replyText, 'SIM_OUT_' + crypto.randomUUID(), 'sent');

      const updatedAppointments = db.appointments.findUpcomingByCustomerId(customer.id, customer.phone);

      return res.json({
        reply: replyText,
        customer,
        conversationId: conversation.id,
        appointments: updatedAppointments,
      });
    } catch (err: any) {
      console.error('[router] Operation requires review');
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/simulator/reset
   * Direct reset trigger
   */
  router.post('/reset', (req: Request, res: Response) => {
    try {
      const phone = normalizePhone(req.body?.phone);
      const customer = db.customers.findByPhone(phone);
      if (customer) {
        const activeAppts = db.appointments.findUpcomingByCustomerId(customer.id, customer.phone);
        for (const appt of activeAppts) {
          db.appointments.updateStatus(appt.id, 'cancelled');
        }
        if (db.workflows) {
          const wf = db.workflows.findActiveByCustomerId(customer.id);
          if (wf) {
            db.workflows.transition(wf.id, 'expired');
          }
        }
        const activeConv = db.conversations.findActiveByCustomerId(customer.id);
        if (activeConv) {
          db.conversations.updateStatus(activeConv.id, 'closed');
        }
      }
      resetRateLimit(phone);

      return res.json({ success: true, message: 'Session reset successfully' });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
}
