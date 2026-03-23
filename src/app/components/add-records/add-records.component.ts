import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  PublisherMonthlyRecord,
  PublisherRecord,
  SupabaseService,
} from '../../services/supabase.service';
import { ServiceYearSelectorComponent } from '../service-year-selector/service-year-selector.component';

@Component({
  selector: 'app-add-records',
  standalone: true,
  imports: [CommonModule, FormsModule, ServiceYearSelectorComponent],
  templateUrl: './add-records.component.html',
  styleUrl: './add-records.component.css',
})
export class AddRecordsComponent implements OnInit {
  protected error: string | null = null;
  protected success: string | null = null;
  protected saving = false;
  protected recordsLoading = false;

  protected publisherName = '';
  protected dateOfBirth = '';
  protected dateOfBaptism = '';
  protected gender: 'male' | 'female' | 'other' | '' = '';
  protected otherSheep = false;
  protected anointed = false;
  protected elder = false;
  protected ministerialServant = false;
  protected regularPioneer = false;
  protected specialPioneer = false;
  protected fieldMissionary = false;
  protected monthlyRecords: PublisherMonthlyRecord[] = this.createDefaultMonths();
  protected yearRecords: PublisherRecord[] = [];

  constructor(
    protected readonly supabase: SupabaseService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadRecordsForYear();
  }

  protected async onYearChanged(): Promise<void> {
    await this.loadRecordsForYear();
  }

  protected onEditRecord(record: PublisherRecord): void {
    this.publisherName = record.publisher_name;
    this.dateOfBirth = record.date_of_birth ?? '';
    this.dateOfBaptism = record.date_of_baptism ?? '';
    this.gender = record.gender ?? '';
    this.otherSheep = record.other_sheep;
    this.anointed = record.anointed;
    this.elder = record.elder;
    this.ministerialServant = record.ministerial_servant;
    this.regularPioneer = record.regular_pioneer;
    this.specialPioneer = record.special_pioneer;
    this.fieldMissionary = record.field_missionary;

    const defaultMonths = this.createDefaultMonths();
    this.monthlyRecords = defaultMonths.map((month) => {
      const existing = record.months.find((item) => item.month === month.month);
      return existing
        ? {
            month: existing.month,
            sharedInMinistry: Boolean(existing.sharedInMinistry),
            bibleStudies: existing.bibleStudies ?? null,
            auxiliaryPioneer: Boolean(existing.auxiliaryPioneer),
            hours: existing.hours ?? null,
            remarks: existing.remarks ?? '',
          }
        : month;
    });
    this.success = `Loaded ${record.publisher_name}.`;
    this.error = null;
    this.cdr.detectChanges();
  }

  protected async onSaveRecord(): Promise<void> {
    this.error = null;
    this.success = null;
    this.saving = true;
    this.cdr.detectChanges();

    try {
      const publisherName = this.publisherName.trim();
      if (!publisherName) {
        this.error = 'Publisher name is required.';
        return;
      }

      const serviceYear = this.supabase.serviceYear();

      const payload: PublisherRecord = {
        service_year_start: serviceYear,
        publisher_name: publisherName,
        date_of_birth: this.dateOfBirth || null,
        date_of_baptism: this.dateOfBaptism || null,
        gender: this.gender || null,
        other_sheep: this.otherSheep,
        anointed: this.anointed,
        elder: this.elder,
        ministerial_servant: this.ministerialServant,
        regular_pioneer: this.regularPioneer,
        special_pioneer: this.specialPioneer,
        field_missionary: this.fieldMissionary,
        months: this.monthlyRecords.map((item) => ({
          month: item.month,
          sharedInMinistry: item.sharedInMinistry,
          bibleStudies: item.bibleStudies == null ? null : Number(item.bibleStudies),
          auxiliaryPioneer: item.auxiliaryPioneer,
          hours: item.hours == null ? null : Number(item.hours),
          remarks: item.remarks?.trim() ?? '',
        })),
      };

      await this.supabase.upsertPublisherRecord(payload);
      this.success = `Saved ${publisherName} for service year ${this.supabase.serviceYearLabel()}.`;
      await this.loadRecordsForYear();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to save publisher record.';
    } finally {
      this.saving = false;
      this.cdr.detectChanges();
    }
  }

  protected onResetForm(): void {
    this.publisherName = '';
    this.dateOfBirth = '';
    this.dateOfBaptism = '';
    this.gender = '';
    this.otherSheep = false;
    this.anointed = false;
    this.elder = false;
    this.ministerialServant = false;
    this.regularPioneer = false;
    this.specialPioneer = false;
    this.fieldMissionary = false;
    this.monthlyRecords = this.createDefaultMonths();
    this.success = null;
    this.error = null;
  }

  private async loadRecordsForYear(): Promise<void> {
    this.recordsLoading = true;
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

  private createDefaultMonths(): PublisherMonthlyRecord[] {
    return [
      'September', 'October', 'November', 'December',
      'January', 'February', 'March', 'April',
      'May', 'June', 'July', 'August',
    ].map((month) => ({
      month,
      sharedInMinistry: false,
      bibleStudies: null,
      auxiliaryPioneer: false,
      hours: null,
      remarks: '',
    }));
  }
}
