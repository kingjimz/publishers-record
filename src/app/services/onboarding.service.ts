import { Injectable, signal } from '@angular/core';

import { SupabaseService } from './supabase.service';

const STORAGE_VERSION = 'v1';

/**
 * First-time welcome: localStorage per user, optional session deferral, and
 * a manual "How to use" entry from the layout menu.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingService {
  readonly dialogOpen = signal(false);

  private _openReason: 'auto' | 'help' | null = null;

  constructor(private readonly supabase: SupabaseService) {}

  private permanentKey(): string | null {
    const id = this.supabase.user()?.id;
    return id ? `publishers-record-onboarding-${STORAGE_VERSION}-${id}` : null;
  }

  private get sessionDeferKey(): string {
    return `publishers-record-onboarding-defer-${STORAGE_VERSION}`;
  }

  isPermanentlyDismissed(): boolean {
    const k = this.permanentKey();
    if (!k || typeof localStorage === 'undefined') return true;
    return localStorage.getItem(k) === '1';
  }

  private isDeferredThisSession(): boolean {
    if (typeof sessionStorage === 'undefined') return false;
    return sessionStorage.getItem(this.sessionDeferKey) === '1';
  }

  /** Show welcome on first authenticated visit (per browser user), unless deferred this session. */
  tryAutoOpen(): void {
    if (!this.supabase.isAuthenticated()) return;
    if (this.isPermanentlyDismissed()) return;
    if (this.isDeferredThisSession()) return;
    this._openReason = 'auto';
    this.dialogOpen.set(true);
  }

  /** Account menu — always available, ignores session deferral. */
  openHelp(): void {
    if (!this.supabase.isAuthenticated()) return;
    this._openReason = 'help';
    this.dialogOpen.set(true);
  }

  isHelpMode(): boolean {
    return this._openReason === 'help';
  }

  markPermanentlyDismissed(): void {
    const k = this.permanentKey();
    if (k) localStorage.setItem(k, '1');
  }

  /** Hide auto-onboarding until the browser session ends (tab closed). */
  deferUntilNextSession(): void {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(this.sessionDeferKey, '1');
  }

  /** Primary CTA: stop showing automatically; close dialog. */
  onGotIt(): void {
    this.markPermanentlyDismissed();
    this.closeDialog();
  }

  /** Secondary: close without permanent dismiss (auto flow only). */
  onRemindLater(): void {
    if (this._openReason === 'auto') {
      this.deferUntilNextSession();
    }
    this.closeDialog();
  }

  /** X button or Close in help mode. */
  onDismissOverlay(): void {
    if (this._openReason === 'auto') {
      this.deferUntilNextSession();
    }
    this.closeDialog();
  }

  private closeDialog(): void {
    this._openReason = null;
    this.dialogOpen.set(false);
  }
}
