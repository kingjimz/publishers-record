import { Injectable, signal } from '@angular/core';

export interface ReportPrefillIntent {
  publisherName: string;
  month: string;
  hours: number | null;
  bibleStudies: number | null;
  sharedInMinistry: boolean;
}

@Injectable({ providedIn: 'root' })
export class ReportPrefillService {
  private readonly _intent = signal<ReportPrefillIntent | null>(null);

  set(intent: ReportPrefillIntent): void {
    this._intent.set(intent);
  }

  consume(): ReportPrefillIntent | null {
    const v = this._intent();
    this._intent.set(null);
    return v;
  }
}
