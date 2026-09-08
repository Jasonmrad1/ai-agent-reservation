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

const OPT_OUT_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'QUIT', 'OPTOUT']);
const OPT_IN_KEYWORDS = new Set(['START', 'UNSTOP']);

export function createWebhookRouter(options: WebhookHandlerOptions) {
  const { db, gateway, authToken, skipSignatureVerification, processMessage } = options;

  async function handleInboundMessage(req: Request, res: Response): Promise<void> {
    const params = req.body || {};
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

    // 2. Signature Verification
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
    const isDoctorOutbound = fromDigits && clinicDigits && (fromDigits === clinicDigits || fromDigits.endsWith(clinicDigits));

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

    // 7. Doctor Direct Chat Co-presence (Yielding to Dr. Ziad during 1-on-1 human conversation or active escalation)
    const lower = incomingText.toLowerCase();
    const upper = incomingText.toUpperCase();
    const isConfirmation = upper === 'YES' || upper === 'CONFIRM' || upper === 'EHH' || upper === 'AKID' || upper === 'OUI' || upper === 'TAMAM';
    const explicitScheduling = (
      isConfirmation ||
      lower.includes('maw3ad') ||
      lower.includes('appointment') ||
      lower.includes('book') ||
      lower.includes('reschedule') ||
      lower.includes('cancel') ||
      lower.includes('aymta fade') ||
      lower.includes('bot') ||
      lower.includes('assistant') ||
      lower.includes('help')
    );

    if ((conversation.status === 'doctor_active' || conversation.status === 'escalated') && !explicitScheduling) {
      console.log(`[Twilio Webhook] 👨‍⚕️ Conversation with ${customer.phone} is in ${conversation.status} mode. Yielding to Dr. Ziad.`);
      res.type('text/xml').send('<Response/>');
      return;
    }

    if (explicitScheduling && (conversation.status === 'doctor_active' || conversation.status === 'escalated')) {
      db.conversations.updateStatus(conversation.id, 'active');
      conversation.status = 'active';
    }

    // 8. Process Message with Gemini Core (with multi-model failover)
    let replyText = "Ahla fik! Kif fina nse3dak l yom bi 3iyadetna?";
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
        replyText = 'Ahla fik! 3enna shwayyet ta2kheer bi seystem, bas tkram 3aynak ra7 nse3dak bi a2rab wa2et. Ayya se3a btnesbak kermel l maw3ad?';
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
