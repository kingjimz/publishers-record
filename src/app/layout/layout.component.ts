import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.css',
})
export class LayoutComponent {
  readonly supabase: SupabaseService;
  headerMenuOpen = false;

  constructor(supabaseService: SupabaseService) {
    this.supabase = supabaseService;
  }

  toggleHeaderMenu(): void {
    this.headerMenuOpen = !this.headerMenuOpen;
  }

  closeHeaderMenu(): void {
    this.headerMenuOpen = false;
  }

  async onSignOut(): Promise<void> {
    this.closeHeaderMenu();
    await this.supabase.signOut();
  }
}
