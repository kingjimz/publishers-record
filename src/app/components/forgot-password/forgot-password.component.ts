import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { SupabaseService } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.css',
})
export class ForgotPasswordComponent implements OnInit {
  protected email = '';
  protected newPassword = '';
  protected confirmPassword = '';
  protected loading = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly router: Router,
    private readonly toast: ToastService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (this.supabase.isAuthenticated()) {
      void this.router.navigate(['/dashboard']);
    }
  }

  protected async onSubmit(): Promise<void> {
    this.toast.dismiss();
    this.loading = true;
    this.cdr.detectChanges();

    try {
      if (!this.supabase.client) {
        this.toast.showError('Authentication is not configured yet.');
        return;
      }

      const email = this.email.trim();
      if (!email) {
        this.toast.showError('Please enter your email.');
        return;
      }
      if (!this.newPassword) {
        this.toast.showError('Please enter a new password.');
        return;
      }
      if (this.newPassword !== this.confirmPassword) {
        this.toast.showError('New password and confirmation do not match.');
        return;
      }

      const err = await this.supabase.resetPasswordWithEmail(email, this.newPassword);
      if (err) {
        this.toast.showError(err);
        return;
      }

      this.toast.showSuccess('Password updated. You can sign in with your new password.');
      await this.router.navigate(['/login']);
    } catch (e) {
      this.toast.showError(e instanceof Error ? e.message : 'Password reset failed unexpectedly.');
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }
}
