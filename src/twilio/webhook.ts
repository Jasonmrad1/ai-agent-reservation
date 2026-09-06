import { Request, Response } from 'express';
import { DatabaseContext } from '../db/index.js';
import { WhatsAppGateway } from './client.js';
import { verifyTwilioWebhook } from './verifier.js';

export interface WebhookHandlerOptions {
  db: DatabaseContext;
  gateway: WhatsAppGateway;
  authToken?: string;
  skipSignatureVerification?: boolean;
  processMessage?: (context: {
    customer: any;
    conversation: any;
    incomingText: string;
    db: DatabaseContext;
  }) => Promise<string>;
}

const OPT_OUT_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const OPT_IN_KEYWORDS = new Set(['START', 'UNSTOP']);

export function createWebhookRouter(options: WebhookHandlerOptions) {
  const { db, gateway, authToken, skipSignatureVerification, processMessage } = options;

  async function handleInboundMessage(req: Request, res: Response): Promise<void> {
    const params = req.body || {};
    const messageSid = params.MessageSid;
    const fromPhone = params.From;
    const incomingText = (params.Body || '').trim();
    const profileName = params.ProfileName;

    console.log(`\n[Twilio Webhook] 📩 Incoming message from ${fromPhone} (${profileName || 'Patient'}): "${incomingText}"`);

    // 1. Signature Verification
    if (!skipSignatureVerification && authToken) {
      const signature = req.headers['x-twilio-signature'] as string;
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const url = `${protocol}://${host}${req.originalUrl}`;

      const isValid = verifyTwilioWebhook({
        authToken,
        signatureHeader: signature,
        url,
        params,
        skipValidationInTest: false,
      });

      if (!isValid) {
        console.warn(`[Twilio Webhook] ⚠️ Rejected request due to invalid signature from ${fromPhone}`);
        res.status(403).send('Invalid signature');
        return;
      }
    }

    if (!fromPhone || !incomingText) {
      console.warn(`[Twilio Webhook] ⚠️ Missing From or Body in request`);
      res.status(400).send('Missing From or Body');
      return;
    }

    // 2. Idempotency Check: if MessageSid already processed, return 200 without duplicate action
    if (messageSid) {
      const existingMessage = db.messages.findByMessageSid(messageSid);
      if (existingMessage) {
        res.type('text/xml').send('<Response/>');
        return;
      }
    }

    // 3. Customer & Conversation Resolution
    const customer = db.customers.findOrCreate(fromPhone, profileName);
    const conversation = db.conversations.getOrCreateActive(customer.id);
    db.conversations.touch(conversation.id);

    // 4. Inbound Message Audit Logging
    db.messages.create(
      conversation.id,
      'inbound',
      incomingText,
      messageSid,
      'received',
      params
    );

    // 5. Opt-Out / Opt-In Handling (§5: honor WhatsApp opt-outs immediately)
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

    // 6. Escalation Check: if conversation is currently escalated to a human, notify human queue
    if (conversation.status === 'escalated') {
      db.alerts.create({
        type: 'human_handoff',
        title: `Customer Message during Escalation (${customer.name || customer.phone})`,
        details: incomingText,
        customer_id: customer.id,
      });
      res.type('text/xml').send('<Response/>');
      return;
    }

    // 7. Process Message (default fallback or Gemini Core)
    let replyText = "Thank you for reaching out! We've received your message and will get back to you shortly.";
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
      } catch (err: any) {
        console.error('[Agent] ❌ Error processing message with Gemini:', err);
        replyText = 'I am having trouble processing your request right now. Let me connect you with our team.';
        db.conversations.updateStatus(conversation.id, 'escalated');
        db.alerts.create({
          type: 'system_error',
          title: `Processing Error for ${customer.phone}`,
          details: err?.message || String(err),
          customer_id: customer.id,
        });
      }
    }

    // 8. Outbound Reply via WhatsApp Gateway
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
    const params = req.body || {};
    const messageSid = params.MessageSid;
    const messageStatus = params.MessageStatus; // 'sent', 'delivered', 'failed', 'undelivered'

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
