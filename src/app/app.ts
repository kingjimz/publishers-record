import { Component, OnInit, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SupabaseService } from './services/supabase.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  protected readonly title = signal('publishers-record');

  constructor(private readonly supabase: SupabaseService) {}

  async ngOnInit(): Promise<void> {
    if (!this.supabase.client) return;

    const { data, error } = await this.supabase.client.auth.getSession();
    if (error) {
      // eslint-disable-next-line no-console
      console.error('Supabase auth getSession error:', error);
      return;
    }

    // eslint-disable-next-line no-console
    console.log('Supabase session loaded:', data.session);
  }
}
