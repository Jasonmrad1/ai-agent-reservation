import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  port: number;
  databaseUrl: string;
  adminSessionSecret: string;
  adminWhatsappNumber: string;
  homeVisitBufferMinutes: number;
  
  // Twilio
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioWhatsappNumber?: string;

  // Gemini
  geminiApiKey?: string;

  // Google Calendar
  googleCalendarClientId?: string;
  googleCalendarClientSecret?: string;
  googleCalendarId?: string;

  // Optional Stripe
  stripeSecretKey?: string;

  // Mode
  nodeEnv: string;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'data/automation.sqlite',
  adminSessionSecret: process.env.ADMIN_SESSION_SECRET || 'dev_secret_change_in_production_123',
  adminWhatsappNumber: process.env.ADMIN_WHATSAPP_NUMBER || 'whatsapp:+15551234567',
  homeVisitBufferMinutes: parseInt(process.env.HOME_VISIT_BUFFER_MINUTES || '30', 10),

  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioWhatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',

  geminiApiKey: process.env.GEMINI_API_KEY,

  googleCalendarClientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
  googleCalendarClientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  googleCalendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',

  stripeSecretKey: process.env.STRIPE_SECRET_KEY,

  nodeEnv: process.env.NODE_ENV || 'development',
};
