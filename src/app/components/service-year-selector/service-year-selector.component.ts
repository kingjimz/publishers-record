import { Component, computed, EventEmitter, Output } from '@angular/core';
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

  /** True when the selected year is already the latest allowed (cannot go into the future). */
  readonly nextDisabled = computed(
    () =>
      this.supabase.serviceYear() >= SupabaseService.allowedMaxServiceYearStart()
  );

  @Output() yearChanged = new EventEmitter<number>();

  constructor(supabaseService: SupabaseService) {
    this.supabase = supabaseService;
  }

  onPrevious(): void {
    this.supabase.previousServiceYear();
    this.yearChanged.emit(this.supabase.serviceYear());
  }

  onNext(): void {
    if (this.nextDisabled()) return;
    this.supabase.nextServiceYear();
    this.yearChanged.emit(this.supabase.serviceYear());
  }
}
