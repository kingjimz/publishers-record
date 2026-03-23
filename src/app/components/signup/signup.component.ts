import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './signup.component.html',
  styleUrl: './signup.component.css',
})
export class SignupComponent implements OnInit {
  protected fullName = '';
  protected email = '';
  protected password = '';

  protected loading = false;
  protected error: string | null = null;
  protected success: string | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (this.supabase.isAuthenticated()) {
      this.router.navigate(['/dashboard']);
    }
  }

  protected async onSignup(): Promise<void> {
    this.error = null;
    this.success = null;
    this.loading = true;
    this.cdr.detectChanges();

    try {
      if (!this.supabase.client) {
        this.error = 'Authentication is not configured yet.';
        return;
      }

      const email = this.email.trim();
      if (!email) {
        this.error = 'Please enter your email.';
        return;
      }
      if (!this.password) {
        this.error = 'Please create a password.';
        return;
      }

      const fullName = this.fullName.trim();
      const signupOptions = fullName ? { data: { full_name: fullName } } : undefined;

      const { data, error } = await this.supabase.signUp(email, this.password, signupOptions);

      if (error) {
        this.error = error.message;
        return;
      }

      if (data.session) {
        await this.router.navigate(['/dashboard']);
        return;
      }

      this.success = 'Check your email to confirm your account, then sign in.';
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Signup failed unexpectedly.';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }
}
