export const environment = {
  production: false,
  // Supabase project settings
  supabaseUrl: 'https://dwsrhagtljarrnfcghcd.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3c3JoYWd0bGphcnJuZmNnaGNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzEyODYsImV4cCI6MjA4OTg0NzI4Nn0.86nnvxK9c0B-IbRlca8YaACmZuDvGVp3CA18-UOBCSc',

  /**
   * OpenRouter (https://openrouter.ai) — optional AI summaries in Search Records.
   * Prefer a local-only value: anyone with the built app can extract keys embedded here.
   */
  openRouterApiKey: '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',
  /** Default uses OpenRouter’s free model router. */
  openRouterModel: 'openrouter/free',
};

