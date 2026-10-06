// Installed before application imports: dotenv must not fill these from .env.
for (const key of [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'GEMINI_API_KEY',
  'GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET',
]) process.env[key] = '';
process.env.NODE_ENV = 'test';
