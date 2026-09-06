import twilio from 'twilio';

export interface VerifyWebhookOptions {
  authToken: string;
  signatureHeader?: string;
  url: string;
  params: Record<string, any>;
  skipValidationInTest?: boolean;
}

export function verifyTwilioWebhook(options: VerifyWebhookOptions): boolean {
  if (options.skipValidationInTest) {
    return true;
  }

  if (!options.signatureHeader || !options.authToken) {
    return false;
  }

  try {
    return twilio.validateRequest(
      options.authToken,
      options.signatureHeader,
      options.url,
      options.params
    );
  } catch {
    return false;
  }
}
