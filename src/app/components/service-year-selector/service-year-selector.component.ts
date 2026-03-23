import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-service-year-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './service-year-selector.component.html',
  styleUrl: './service-year-selector.component.css',
})
export class ServiceYearSelectorComponent {
  readonly supabase: SupabaseService;

  @Output() yearChanged = new EventEmitter<number>();

  constructor(supabaseService: SupabaseService) {
    this.supabase = supabaseService;
  }

  onPrevious(): void {
    this.supabase.previousServiceYear();
    this.yearChanged.emit(this.supabase.serviceYear());
  }

  onNext(): void {
    this.supabase.nextServiceYear();
    this.yearChanged.emit(this.supabase.serviceYear());
  }
}
