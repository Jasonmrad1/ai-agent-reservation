import twilio from 'twilio';
import crypto from 'node:crypto';
import { withRetry } from '../utils/retry.js';
import { AdminAlertRepository } from '../db/repositories/alert.repo.js';

export interface SendMessageResult {
  messageSid: string;
  status: 'sent' | 'queued' | 'failed';
  to: string;
  body: string;
}

export interface WhatsAppGateway {
  sendMessage(to: string, body: string, customerId?: string): Promise<SendMessageResult>;
}

export class MockWhatsAppGateway implements WhatsAppGateway {
  public sentMessages: SendMessageResult[] = [];
  public shouldFail: boolean = false;
  public failureCountRemaining: number = 0;

  public async sendMessage(to: string, body: string, _customerId?: string): Promise<SendMessageResult> {
    if (this.shouldFail || this.failureCountRemaining > 0) {
      if (this.failureCountRemaining > 0) {
        this.failureCountRemaining--;
      }
      throw new Error('Simulated WhatsApp network failure');
    }

    const result: SendMessageResult = {
      messageSid: 'SM_MOCK_' + crypto.randomUUID().substring(0, 8),
      status: 'sent',
      to,
      body,
    };
    this.sentMessages.push(result);
    return result;
  }

  public clear(): void {
    this.sentMessages = [];
    this.shouldFail = false;
    this.failureCountRemaining = 0;
  }
}

export class TwilioWhatsAppGateway implements WhatsAppGateway {
  private client: twilio.Twilio;

  constructor(
    private accountSid: string,
    private authToken: string,
    private fromNumber: string,
    private alertRepo?: AdminAlertRepository,
    private statusCallback?: string
  ) {
    this.client = twilio(accountSid, authToken);
  }

  public async sendMessage(to: string, body: string, customerId?: string): Promise<SendMessageResult> {
    // Format recipient number (ensure 'whatsapp:' prefix)
    const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const formattedFrom = this.fromNumber.startsWith('whatsapp:') ? this.fromNumber : `whatsapp:${this.fromNumber}`;

    try {
      const createOptions: any = {from:formattedFrom,to:formattedTo,body};
      if(this.statusCallback && this.statusCallback!=='none') createOptions.statusCallback=this.statusCallback;
      // Sending is not idempotent. Retry only through the durable outbox after a definite rejection.
      const response=await this.client.messages.create(createOptions);

      return {
        messageSid: response.sid,
        status: (response.status as any) || 'sent',
        to: formattedTo,
        body,
      };
    } catch (error: any) {
      // Per §5: "No fallback channel, so retry harder... raise a dashboard alert for the admin rather than silently giving up."
      if (this.alertRepo) {
        this.alertRepo.create({
          type: 'delivery_failure',
          title: `WhatsApp Send Failed to ${formattedTo}`,
          details: `Error after retries: ${error?.message || error}. Message body: "${body.substring(0, 100)}..."`,
          customer_id: customerId,
        });
      }
      throw error;
    }
  }
}
