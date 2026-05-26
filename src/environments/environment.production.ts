import { openRouterApiKeyFromEnv, openRouterModelFromEnv } from './open-router-define';

export const environment = {
  production: true,
  // Supabase project settings
  supabaseUrl: 'https://dwsrhagtljarrnfcghcd.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3c3JoYWd0bGphcnJuZmNnaGNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzEyODYsImV4cCI6MjA4OTg0NzI4Nn0.86nnvxK9c0B-IbRlca8YaACmZuDvGVp3CA18-UOBCSc',

  serviceReportsSupabaseUrl: 'https://uheznkhfsbweqkjmuisu.supabase.co',
  serviceReportsSupabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoZXpua2hmc2J3ZXFram11aXN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk1NzU2NTgsImV4cCI6MjA4NTE1MTY1OH0.ZvON8fI68G9MpoH_SUBurUjSpqVQbE6TWYvROEbDvX0',

  openRouterApiKey: openRouterApiKeyFromEnv,
  openRouterModel: openRouterModelFromEnv || 'openrouter/free',
};

