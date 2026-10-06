import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  mode?: 'clinic' | 'simulator';
  publicBaseUrl?: string;
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
  googleCalendarRedirectUri?: string;

  // Optional Stripe
  stripeSecretKey?: string;

  // Supabase
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;

  // Mode
  nodeEnv: string;
}

export const config: AppConfig = {
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  mode: process.env.APP_MODE === 'clinic' ? 'clinic' : process.env.APP_MODE === 'simulator' ? 'simulator' : undefined,
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
  googleCalendarRedirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI || 'http://localhost:3000/oauth2callback',

  stripeSecretKey: process.env.STRIPE_SECRET_KEY,

  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,

  nodeEnv: process.env.NODE_ENV || 'development',
};

export function validateConfig(cfg: AppConfig): void {
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535 ||
      !Number.isFinite(cfg.homeVisitBufferMinutes) || cfg.homeVisitBufferMinutes < 0) {
    throw new Error('Invalid application configuration: port or travel buffer');
  }
  if (cfg.nodeEnv !== 'production') return;
  if (cfg.adminSessionSecret.length < 32 || cfg.adminSessionSecret.includes('change_in_production')) {
    throw new Error('Invalid production configuration: a strong administrator secret is required');
  }
  if (cfg.mode === 'simulator') return;
  if (!cfg.twilioAccountSid || !cfg.twilioAuthToken || !cfg.twilioWhatsappNumber ||
      !cfg.geminiApiKey || !cfg.googleCalendarClientId || !cfg.googleCalendarClientSecret) {
    throw new Error('Incomplete production clinic configuration: Twilio, Gemini and Google Calendar are required');
  }
}
