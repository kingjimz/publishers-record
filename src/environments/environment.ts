import { openRouterApiKeyFromEnv, openRouterModelFromEnv } from './open-router-define';

export const environment = {
  production: false,
  // Supabase project settings
  supabaseUrl: 'https://dwsrhagtljarrnfcghcd.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3c3JoYWd0bGphcnJuZmNnaGNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzEyODYsImV4cCI6MjA4OTg0NzI4Nn0.86nnvxK9c0B-IbRlca8YaACmZuDvGVp3CA18-UOBCSc',

  /** Build-time from `.env` / CI env (see .env.example and scripts/ng-with-openrouter-env.cjs). */
  openRouterApiKey: openRouterApiKeyFromEnv,
  openRouterModel: openRouterModelFromEnv || 'openrouter/free',
};

