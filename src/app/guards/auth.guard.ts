import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';

import { SupabaseService } from '../services/supabase.service';

export const authGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const supabase = inject(SupabaseService);

  if (!supabase.client) {
    router.navigate(['/login']);
    return false;
  }

  await supabase.ensureSession();

  if (supabase.isAuthenticated()) return true;

  router.navigate(['/login']);
  return false;
};
