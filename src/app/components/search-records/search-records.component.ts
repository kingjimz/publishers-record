import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PublisherRecord, SupabaseService } from '../../services/supabase.service';
import { ServiceYearSelectorComponent } from '../service-year-selector/service-year-selector.component';

@Component({
  selector: 'app-search-records',
  standalone: true,
  imports: [CommonModule, FormsModule, ServiceYearSelectorComponent],
  templateUrl: './search-records.component.html',
  styleUrl: './search-records.component.css',
})
export class SearchRecordsComponent {
  protected loading = false;
  protected error: string | null = null;
  protected query = '';
  protected hasSearched = false;
  protected records: PublisherRecord[] = [];
  protected expandedPublisher: string | null = null;

  constructor(
    protected readonly supabase: SupabaseService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  protected async onSearch(): Promise<void> {
    const text = this.query.trim();
    if (!text) return;

    this.hasSearched = true;
    await this.loadRecords();
  }

  protected onClear(): void {
    this.query = '';
    this.hasSearched = false;
    this.records = [];
    this.expandedPublisher = null;
  }

  protected async onYearChanged(): Promise<void> {
    if (!this.hasSearched) return;
    await this.loadRecords();
  }

  protected get filteredRecords(): PublisherRecord[] {
    const text = this.query.trim().toLowerCase();
    if (!text) return [];
    return this.records.filter((r) => r.publisher_name.toLowerCase().includes(text));
  }

  protected toggleExpand(name: string): void {
    this.expandedPublisher = this.expandedPublisher === name ? null : name;
  }

  protected getActiveMonths(record: PublisherRecord): number {
    return record.months?.filter((m) => m.sharedInMinistry).length ?? 0;
  }

  protected getTotalHours(record: PublisherRecord): number {
    return record.months?.reduce((sum, m) => sum + (m.hours ?? 0), 0) ?? 0;
  }

  private async loadRecords(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.cdr.detectChanges();

    try {
      this.records = await this.supabase.getPublisherRecordsByServiceYear(
        this.supabase.serviceYear()
      );
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load records.';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }
}
