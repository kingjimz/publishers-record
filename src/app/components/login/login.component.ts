import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
})
export class LoginComponent implements OnInit {
  protected email = '';
  protected password = '';
  protected loading = false;
  protected error: string | null = null;

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

  protected async onLogin(): Promise<void> {
    this.error = null;
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
        this.error = 'Please enter your password.';
        return;
      }

      const { error } = await this.supabase.signInWithPassword(email, this.password);
      if (error) {
        this.error = error.message;
        return;
      }

      await this.router.navigate(['/dashboard']);
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Login failed unexpectedly.';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }
}
