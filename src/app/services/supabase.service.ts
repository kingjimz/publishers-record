import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  /**
   * `null` until you set `environment.supabaseUrl` + `environment.supabaseAnonKey`.
   * This prevents the app from crashing while you’re wiring credentials.
   */
  public readonly client: SupabaseClient | null;

  constructor() {
    const url = environment.supabaseUrl;
    const anonKey = environment.supabaseAnonKey;

    this.client = url && anonKey ? createClient(url, anonKey) : null;

    if (!this.client) {
      // eslint-disable-next-line no-console
      console.warn(
        'SupabaseService: missing `supabaseUrl` and/or `supabaseAnonKey` in environment files.'
      );
    }
  }
}

