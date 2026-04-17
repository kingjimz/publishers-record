import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { PublisherRecord, SupabaseService } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';
import { ServiceYearSelectorComponent } from '../service-year-selector/service-year-selector.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ServiceYearSelectorComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit {
  protected recordsLoading = false;
  protected yearRecords: PublisherRecord[] = [];

  constructor(
    protected readonly supabase: SupabaseService,
    private readonly router: Router,
    private readonly toast: ToastService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadRecordsForYear();
  }

  protected async onYearChanged(): Promise<void> {
    await this.loadRecordsForYear();
  }

  protected get totalPublishers(): number {
    return this.yearRecords.filter((r) => !r.inactive).length;
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

  protected get unbaptizedPublisherCount(): number {
    return this.yearRecords.filter((r) => r.unbaptized_publisher).length;
  }

  protected get inactivePublisherCount(): number {
    return this.yearRecords.filter((r) => !!r.inactive).length;
  }

  protected searchQuery = '';

  protected async onEldersCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'elder' },
    });
  }

  protected async onRegularPioneersCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'regular-pioneer' },
    });
  }

  protected async onTotalPublishersCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'all' },
    });
  }

  protected async onAuxiliaryPioneersCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'auxiliary-pioneer' },
    });
  }

  protected async onMinisterialServantsCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'ministerial-servant' },
    });
  }

  protected async onUnbaptizedPublishersCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'unbaptized-publisher' },
    });
  }

  protected async onInactivePublishersCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'inactive' },
    });
  }

  protected async onDashboardSearch(): Promise<void> {
    const text = this.searchQuery.trim();
    if (!text) return;
    await this.router.navigate(['/publishers-record/search-records'], { queryParams: { q: text } });
  }

  protected onClearSearch(): void {
    this.searchQuery = '';
  }

  private async loadRecordsForYear(): Promise<void> {
    this.recordsLoading = true;
    this.cdr.detectChanges();

    try {
      this.yearRecords = await this.supabase.getPublisherRecordsByServiceYear(
        this.supabase.serviceYear()
      );
    } catch (err) {
      this.toast.showError(
        err instanceof Error ? err.message : 'Failed to load service year records.'
      );
    } finally {
      this.recordsLoading = false;
      this.cdr.detectChanges();
    }
  }
}
