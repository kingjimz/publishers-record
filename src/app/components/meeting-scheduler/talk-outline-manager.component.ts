import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { OUTLINE_LANGUAGE, TalkOutline, TalkOutlineService } from '../../services/talk-outline.service';
import { ToastService } from '../../services/toast.service';
import { parseJwpubOutlines } from '../../utils/jwpub-outline-parser';
import { ParsedOutline, ParseResult, parseS99Pdf } from '../../utils/s99-outline-parser';

/** What a replace-upload would do to the stored library. */
interface ImportDiff {
  added: number;
  changed: number;
  removed: number;
}

/**
 * Public Talk Outline library: upload the outline publication from the hub as
 * a .jwpub (or the S-99 list as PDF), parsed in the browser, review and
 * correct the parsed rows, then replace the stored list. Individual outlines
 * can also be added, edited, or removed manually.
 */
@Component({
  selector: 'app-talk-outline-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './talk-outline-manager.component.html',
})
export class TalkOutlineManagerComponent implements OnInit {
  protected outlines: TalkOutline[] = [];
  protected usage = new Map<number, string>();
  protected loading = false;

  /** Parsed S-99 preview awaiting confirmation; null when no upload is pending. */
  protected preview: ParsedOutline[] | null = null;
  protected previewWarnings: string[] = [];
  protected previewFileName = '';
  protected parsing = false;
  protected replacing = false;

  /** Library table state. */
  protected searchQuery = '';
  protected newNumber: number | null = null;
  protected newTitle = '';
  protected savingNew = false;
  protected editing: TalkOutline | null = null;
  protected editNumber: number | null = null;
  protected editTitle = '';
  protected savingEdit = false;
  protected pendingDelete: TalkOutline | null = null;
  protected deleting = false;

  constructor(
    private readonly talkOutlines: TalkOutlineService,
    private readonly toast: ToastService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.cdr.detectChanges();
    try {
      const [outlines, usage] = await Promise.all([
        this.talkOutlines.getOutlines(),
        this.talkOutlines.getOutlineUsage(),
      ]);
      this.outlines = outlines;
      this.usage = usage;
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to load the outlines.');
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.pendingDelete && !this.deleting) this.pendingDelete = null;
    this.cdr.detectChanges();
  }

  // ---------- Outline file upload (.jwpub from the hub, or S-99 PDF) ----------

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // let the same file be picked again after corrections
    if (!file || this.parsing) return;

    const name = file.name.toLowerCase();
    const parse: ((f: File) => Promise<ParseResult>) | null = name.endsWith('.jwpub')
      ? parseJwpubOutlines
      : name.endsWith('.pdf')
        ? parseS99Pdf
        : null;
    if (!parse) {
      this.toast.showError('Unsupported file type. Upload the .jwpub from the hub (or the S-99 PDF).');
      return;
    }

    this.parsing = true;
    this.preview = null;
    this.previewWarnings = [];
    this.previewFileName = file.name;
    this.cdr.detectChanges();

    try {
      const { outlines, warnings } = await parse(file);
      if (outlines.length === 0) {
        this.toast.showError('No talk outlines found in that file. Is it the outlines publication?');
        return;
      }
      this.preview = outlines;
      this.previewWarnings = warnings;
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Could not read the file.');
    } finally {
      this.parsing = false;
      this.cdr.detectChanges();
    }
  }

  /** Preview rows that survive confirmation (valid number + non-empty title). */
  protected get validPreviewRows(): ParsedOutline[] {
    return (this.preview ?? []).filter((row) => row.talk_number > 0 && row.title.trim().length > 0);
  }

  protected get previewDiff(): ImportDiff {
    const current = new Map(this.outlines.map((o) => [o.talk_number, o.title]));
    const next = new Map(this.validPreviewRows.map((row) => [row.talk_number, row.title.trim()]));

    let added = 0;
    let changed = 0;
    for (const [talkNumber, title] of next) {
      const existing = current.get(talkNumber);
      if (existing === undefined) added++;
      else if (existing !== title) changed++;
    }
    let removed = 0;
    for (const talkNumber of current.keys()) {
      if (!next.has(talkNumber)) removed++;
    }
    return { added, changed, removed };
  }

  protected removePreviewRow(row: ParsedOutline): void {
    if (!this.preview) return;
    this.preview = this.preview.filter((r) => r !== row);
  }

  protected cancelPreview(): void {
    this.preview = null;
    this.previewWarnings = [];
    this.previewFileName = '';
    this.cdr.detectChanges();
  }

  protected async confirmReplace(): Promise<void> {
    const rows = this.validPreviewRows;
    if (rows.length === 0 || this.replacing) return;

    // Duplicate numbers would silently collapse in the upsert; stop instead.
    const numbers = rows.map((r) => r.talk_number);
    if (new Set(numbers).size !== numbers.length) {
      this.toast.showError('The preview has duplicate talk numbers. Fix them before saving.');
      return;
    }

    this.replacing = true;
    this.cdr.detectChanges();
    try {
      await this.talkOutlines.replaceAll(OUTLINE_LANGUAGE, rows);
      this.toast.showSuccess(`Outline list replaced (${rows.length} outlines).`);
      this.cancelPreview();
      await this.load();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to save the outlines.');
    } finally {
      this.replacing = false;
      this.cdr.detectChanges();
    }
  }

  // ---------- Library table ----------

  protected get filteredOutlines(): TalkOutline[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.outlines;
    return this.outlines.filter(
      (o) => String(o.talk_number).startsWith(q) || o.title.toLowerCase().includes(q)
    );
  }

  protected lastGiven(talkNumber: number): string | null {
    const iso = this.usage.get(talkNumber);
    if (!iso) return null;
    const date = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  protected async onAddOutline(): Promise<void> {
    const talkNumber = this.newNumber;
    const title = this.newTitle.trim();
    if (!talkNumber || talkNumber < 1 || !title || this.savingNew) return;
    if (this.outlines.some((o) => o.talk_number === talkNumber)) {
      this.toast.showError(`Talk ${talkNumber} already exists. Edit it in the list below.`);
      return;
    }

    this.savingNew = true;
    this.cdr.detectChanges();
    try {
      await this.talkOutlines.saveOutline({
        talk_number: talkNumber,
        title,
        language: OUTLINE_LANGUAGE,
        is_active: true,
      });
      this.newNumber = null;
      this.newTitle = '';
      this.toast.showSuccess(`Talk ${talkNumber} added.`);
      await this.load();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to add the outline.');
    } finally {
      this.savingNew = false;
      this.cdr.detectChanges();
    }
  }

  protected startEdit(outline: TalkOutline): void {
    this.editing = outline;
    this.editNumber = outline.talk_number;
    this.editTitle = outline.title;
  }

  protected cancelEdit(): void {
    this.editing = null;
  }

  protected async saveEdit(): Promise<void> {
    const outline = this.editing;
    const talkNumber = this.editNumber;
    const title = this.editTitle.trim();
    if (!outline || !talkNumber || talkNumber < 1 || !title || this.savingEdit) return;
    if (
      talkNumber !== outline.talk_number &&
      this.outlines.some((o) => o.talk_number === talkNumber)
    ) {
      this.toast.showError(`Talk ${talkNumber} already exists.`);
      return;
    }

    this.savingEdit = true;
    this.cdr.detectChanges();
    try {
      // A renumber is a delete + insert; the upsert conflict key is the number.
      if (talkNumber !== outline.talk_number && outline.id) {
        await this.talkOutlines.deleteOutline(outline.id);
      }
      await this.talkOutlines.saveOutline({
        talk_number: talkNumber,
        title,
        language: outline.language,
        is_active: outline.is_active,
      });
      this.editing = null;
      this.toast.showSuccess(`Talk ${talkNumber} saved.`);
      await this.load();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to save the outline.');
    } finally {
      this.savingEdit = false;
      this.cdr.detectChanges();
    }
  }

  protected async onDeleteOutline(): Promise<void> {
    const outline = this.pendingDelete;
    if (!outline?.id || this.deleting) return;

    this.deleting = true;
    this.cdr.detectChanges();
    try {
      await this.talkOutlines.deleteOutline(outline.id);
      this.pendingDelete = null;
      this.toast.showSuccess(`Talk ${outline.talk_number} removed.`);
      await this.load();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to remove the outline.');
    } finally {
      this.deleting = false;
      this.cdr.detectChanges();
    }
  }

  protected trackPreviewRow(index: number): number {
    return index;
  }
}
