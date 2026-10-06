import { isUrgentMessage } from '../security/urgent.js';
import { Request, Response } from 'express';
import { DatabaseContext } from '../db/index.js';
import { WhatsAppGateway } from './client.js';
import { verifyTwilioWebhook } from './verifier.js';
import { sanitizeWhatsAppText } from '../gemini/agent.js';
import { validateInboundMessage, resetRateLimit } from '../security/guardrails.js';

export interface WebhookHandlerOptions {
  db: DatabaseContext;
  gateway: WhatsAppGateway;
  authToken?: string;
  skipSignatureVerification?: boolean;
  publicBaseUrl?: string;
  processMessage?: (context: {
    customer: any;
    conversation: any;
    incomingText: string;
    db: DatabaseContext;
  }) => Promise<string>;
}

const OPT_OUT_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'QUIT', 'OPTOUT']);
const OPT_IN_KEYWORDS = new Set(['START', 'UNSTOP']);

export function createWebhookRouter(options: WebhookHandlerOptions) {
  const { db, gateway, authToken, skipSignatureVerification, processMessage } = options;

  function isVerified(req: Request): boolean {
    if (skipSignatureVerification) return true;
    const base = options.publicBaseUrl?.replace(/\/$/, '');
    const url = base ? `${base}${req.originalUrl}` : `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    return verifyTwilioWebhook({ authToken: authToken || '', signatureHeader: req.get('x-twilio-signature'), url, params: req.body || {} });
  }

  async function handleInboundMessage(req: Request, res: Response): Promise<void> {
    const params = req.body || {};
    if (!isVerified(req)) { res.status(403).send('Invalid signature'); return; }
    if (typeof params.From !== 'string' || (params.Body != null && typeof params.Body !== 'string') ||
        typeof params.MessageSid !== 'string' || !params.MessageSid) {
      res.status(400).send('Invalid webhook payload'); return;
    }
    const messageSid = params.MessageSid;
    const fromPhone = params.From;
    const profileName = params.ProfileName;

    // 1. Extract body, location pin, or voice notes
    let incomingText = (params.Body || '').trim();

    // Check if WhatsApp location was shared (Twilio Latitude / Longitude)
    const hasLocation = Boolean(params.Latitude && params.Longitude);
    if (hasLocation) {
      const locationLabel = params.Label || params.Address || 'Location Pin';
      const mapsUrl = `https://maps.google.com/?q=${params.Latitude},${params.Longitude}`;
      const locationInfo = `📍 Shared Location: ${locationLabel} (GPS: ${params.Latitude}, ${params.Longitude}) | Maps: ${mapsUrl}`;
      incomingText = incomingText ? `${incomingText}\n${locationInfo}` : locationInfo;
    }

    // Check if WhatsApp voice note or media was sent (Twilio NumMedia / MediaContentType0)
    const numMedia = parseInt(params.NumMedia || '0', 10);
    const isVoiceNote = numMedia > 0 && params.MediaContentType0?.startsWith('audio/');
    if (isVoiceNote && !incomingText) {
      incomingText = '[VOICE_NOTE]';
    } else if (numMedia > 0 && !incomingText) {
      incomingText = `[MEDIA_ATTACHMENT: ${params.MediaContentType0 || 'file'}]`;
    }

    console.log(`\n[Twilio Webhook] 📩 Incoming message from ${fromPhone} (${profileName || 'Patient'}): "${incomingText}"`);

    if (!fromPhone || !incomingText) {
      console.warn(`[Twilio Webhook] ⚠️ Missing From or Body in request`);
      res.status(400).send('Missing From or Body');
      return;
    }

    // 3. Idempotency Check: if MessageSid already processed, return 200 without duplicate action
    if (messageSid) {
      const existingMessage = db.messages.findByMessageSid(messageSid);
      if (existingMessage) {
        res.type('text/xml').send('<Response/>');
        return;
      }
    }

    // 3. Outbound Message Filter (Dr. Ziad talking from the clinic WhatsApp number directly)
    const clinicDigits = (process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886').replace(/\D/g, '');
    const fromDigits = fromPhone.replace(/\D/g, '');
    const isDoctorOutbound = fromDigits && clinicDigits && (fromDigits === clinicDigits);

    if (isDoctorOutbound) {
      const recipientPhone = params.To;
      if (recipientPhone) {
        const patient = db.customers.findOrCreate(recipientPhone, 'Patient');
        const conv = db.conversations.getOrCreateActive(patient.id);
        db.messages.create(conv.id, 'outbound', incomingText, messageSid, 'sent', params);
        db.conversations.updateStatus(conv.id, 'doctor_active');
        console.log(`[Twilio Webhook] 👨‍⚕️ Dr. Ziad sent direct message to ${recipientPhone}. Set conversation to 'doctor_active'.`);
      }
      res.type('text/xml').send('<Response/>');
      return;
    }

    // 4. Customer & Conversation Resolution
    const customer = db.customers.findOrCreate(fromPhone, profileName);
    const conversation = db.conversations.getOrCreateActive(customer.id);
    db.conversations.touch(conversation.id);

    // 5. Inbound Message Audit Logging
    db.messages.create(
      conversation.id,
      'inbound',
      incomingText,
      messageSid,
      'received',
      params
    );

    // 6. Opt-Out / Opt-In Handling (§5: honor WhatsApp opt-outs immediately)
    const upperText = incomingText.toUpperCase();
    if (OPT_OUT_KEYWORDS.has(upperText)) {
      db.customers.setOptOut(customer.id, true);
      const optOutReply = 'You have been unsubscribed and will receive no further messages. Reply START to resubscribe.';
      await gateway.sendMessage(fromPhone, optOutReply, customer.id);
      db.messages.create(conversation.id, 'outbound', optOutReply, null, 'sent');
      res.type('text/xml').send('<Response/>');
      return;
    }

    if (OPT_IN_KEYWORDS.has(upperText)) {
      db.customers.setOptOut(customer.id, false);
      const optInReply = 'Welcome back! You have resubscribed. How can we help you today?';
      await gateway.sendMessage(fromPhone, optInReply, customer.id);
      db.messages.create(conversation.id, 'outbound', optInReply, null, 'sent');
      res.type('text/xml').send('<Response/>');
      return;
    }

    if (customer.opted_out) {
      res.type('text/xml').send('<Response/>');
      return;
    }

    // 6.1 Testing Reset Command (#reset, /reset, #clear)
    const trimmedInput = incomingText.trim().toLowerCase();
    if (trimmedInput === '#reset' || trimmedInput === '/reset' || trimmedInput === '#clear' || trimmedInput === '/clear') {
      console.log(`[Twilio Webhook] 🔄 Received test reset command from ${fromPhone}. Clearing patient chat and test bookings...`);
      const activeAppts = db.appointments.findUpcomingByCustomerId(customer.id);
      for (const appt of activeAppts) {
        db.appointments.updateStatus(appt.id, 'cancelled');
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
      await gateway.sendMessage(fromPhone, resetReply, customer.id);
      db.messages.create(conversation.id, 'outbound', resetReply, null, 'sent');
      res.type('text/xml').send('<Response/>');
      return;
    }

    // 6.2 Security, Prompt-Injection & Anti-Abuse Guardrails (0 Gemini tokens spent)
    const guardrail = validateInboundMessage(incomingText, fromPhone);
    if (!guardrail.allowed && guardrail.reply) {
      await gateway.sendMessage(fromPhone, guardrail.reply, customer.id);
      db.messages.create(conversation.id, 'outbound', guardrail.reply, null, 'sent');
      res.type('text/xml').send('<Response/>');
      return;
    }

    // 7. Doctor Direct Chat Co-presence (Yielding to Dr. Ziad during 1-on-1 human conversation or active escalation)
    const lower = incomingText.toLowerCase();
    const upper = incomingText.toUpperCase();
    const resumeBot=incomingText.trim().toLowerCase()==='/resume bot';
    if ((conversation.status==='doctor_active' || conversation.status==='escalated') && !resumeBot && !isUrgentMessage(incomingText)) {
      res.type('text/xml').send('<Response/>'); return;
    }
    if (resumeBot) {
      db.conversations.updateStatus(conversation.id,'active');conversation.status='active';
      res.type('text/xml').send('<Response/>');return;
    }

    // 8. Process Message with Gemini Core (with multi-model failover)
    let replyText = "Hello! Welcome to Dr. Ziad El Khoury's clinic. How can we help you today?\n\nأهلاً وسهلاً بكم في عيادة الدكتور زياد الخوري. كيف يمكننا مساعدتكم اليوم؟";
    if (processMessage) {
      try {
        console.log(`[Agent] 🧠 Passing message to Gemini agent...`);
        replyText = await processMessage({
          customer,
          conversation,
          incomingText,
          db,
        });
        console.log(`[Agent] 💬 Gemini response drafted: "${replyText}"`);
        
        // Preserve 'escalated' or 'doctor_active' if newly set; otherwise reset to 'active'
        const currentConv = db.conversations.findActiveByCustomerId(customer.id);
        if (currentConv && currentConv.status !== 'escalated' && currentConv.status !== 'doctor_active') {
          db.conversations.updateStatus(conversation.id, 'active');
        }
      } catch (err: any) {
        console.error('[Agent] ❌ Error processing message with Gemini:', err);
        replyText = "Hello! Welcome to Dr. Ziad El Khoury's clinic. We are currently experiencing a brief delay, but we are here to help you right away. What day and time works best for your appointment?\n\nأهلاً وسهلاً بكم في عيادة الدكتور زياد الخوري. نعتذر عن هذا التأخير البسيط، ونحن في خدمتكم فوراً. ما هو اليوم والوقت الأنسب لموعدكم؟";
        db.alerts.create({
          type: 'system_error',
          title: `Processing Error for ${customer.phone}`,
          details: err?.message || String(err),
          customer_id: customer.id,
        });
      }
    }

    replyText = sanitizeWhatsAppText(replyText);
    if (!replyText || !replyText.trim()) {
      console.warn(`[Twilio Webhook] ⚠️ Final replyText was empty, using safe fallback for ${fromPhone}`);
      replyText = "Hello! Welcome to Dr. Ziad El Khoury's clinic. We received your message and are here to help. What day and time works best for your appointment?\n\nأهلاً وسهلاً بكم في عيادة الدكتور زياد الخوري. كيف يمكننا مساعدتكم اليوم وما هو الموعد المناسب لكم؟";
    }
    try {
      console.log(`[Twilio Webhook] 📤 Sending WhatsApp reply to ${fromPhone}...`);
      const sendResult = await gateway.sendMessage(fromPhone, replyText, customer.id);
      console.log(`[Twilio Webhook] ✅ Dispatched WhatsApp reply (SID: ${sendResult.messageSid})`);
      db.messages.create(conversation.id, 'outbound', replyText, sendResult.messageSid, 'sent');
    } catch (sendErr: any) {
      console.error(`[Twilio Webhook] ❌ Failed to send WhatsApp reply to ${fromPhone}:`, sendErr);
      db.messages.create(conversation.id, 'outbound', replyText, null, 'failed');
    }

    res.type('text/xml').send('<Response/>');
  }

  async function handleStatusCallback(req: Request, res: Response): Promise<void> {
    if (!isVerified(req)) { res.status(403).send('Invalid signature'); return; }
    const params = req.body || {};
    const messageSid = params.MessageSid;
    const messageStatus = params.MessageStatus; // 'sent', 'delivered', 'failed', 'undelivered'
    if (typeof messageSid !== 'string' || !['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'undelivered'].includes(messageStatus)) {
      res.status(400).send('Invalid status callback'); return;
    }

    if (messageSid && messageStatus) {
      db.messages.updateStatusBySid(messageSid, messageStatus);

      if (messageStatus === 'failed' || messageStatus === 'undelivered') {
        db.alerts.create({
          type: 'delivery_failure',
          title: `WhatsApp Delivery Failed (${messageStatus})`,
          details: `Message SID: ${messageSid}. Error code: ${params.ErrorCode || 'None'}`,
        });
      }
    }

    res.status(200).send('OK');
  }

  return {
    handleInboundMessage,
    handleStatusCallback,
  };
}
