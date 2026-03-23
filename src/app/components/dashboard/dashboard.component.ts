import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

import { PublisherRecord, SupabaseService } from '../../services/supabase.service';
import { ServiceYearSelectorComponent } from '../service-year-selector/service-year-selector.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ServiceYearSelectorComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit {
  protected error: string | null = null;
  protected recordsLoading = false;
  protected yearRecords: PublisherRecord[] = [];

  constructor(
    protected readonly supabase: SupabaseService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadRecordsForYear();
  }

  protected async goToAddRecords(): Promise<void> {
    await this.router.navigate(['/add-records']);
  }

  protected async goToSearchRecords(): Promise<void> {
    await this.router.navigate(['/search-records']);
  }

  protected async onYearChanged(): Promise<void> {
    await this.loadRecordsForYear();
  }

  protected get totalPublishers(): number {
    return this.yearRecords.length;
  }

  protected get regularPioneerCount(): number {
    return this.yearRecords.filter((r) => r.regular_pioneer).length;
  }

  protected get auxiliaryPioneerCount(): number {
    return this.yearRecords.filter((r) =>
      r.months?.some((m) => m.auxiliaryPioneer)
    ).length;
  }

  protected get elderCount(): number {
    return this.yearRecords.filter((r) => r.elder).length;
  }

  protected get ministerialServantCount(): number {
    return this.yearRecords.filter((r) => r.ministerial_servant).length;
  }

  protected copying = false;
  protected copyMessage: string | null = null;

  protected async onCopyFromPreviousYear(): Promise<void> {
    this.copying = true;
    this.copyMessage = null;
    this.cdr.detectChanges();

    try {
      const currentYear = this.supabase.serviceYear();
      const previousYear = currentYear - 1;
      const count = await this.supabase.copyPublishersFromYear(previousYear, currentYear);

      if (count === 0) {
        this.copyMessage = `No new publishers to copy from ${previousYear}\u2013${previousYear + 1}. They may already exist in the current year.`;
      } else {
        this.copyMessage = `Copied ${count} publisher${count === 1 ? '' : 's'} from ${previousYear}\u2013${previousYear + 1} with blank monthly records.`;
      }
      await this.loadRecordsForYear();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to copy publishers.';
    } finally {
      this.copying = false;
      this.cdr.detectChanges();
    }
  }

  private async loadRecordsForYear(): Promise<void> {
    this.recordsLoading = true;
    this.error = null;
    this.cdr.detectChanges();

    try {
      this.yearRecords = await this.supabase.getPublisherRecordsByServiceYear(
        this.supabase.serviceYear()
      );
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load service year records.';
    } finally {
      this.recordsLoading = false;
      this.cdr.detectChanges();
    }
  }
}
