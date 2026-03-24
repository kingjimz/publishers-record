import { Injectable, signal } from '@angular/core';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastState {
  message: string;
  variant: ToastVariant;
}

const DEFAULT_SUCCESS_MS = 3000;
const DEFAULT_ERROR_MS = 5000;
const DEFAULT_INFO_MS = 3000;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toast = signal<ToastState | null>(null);
  readonly toast = this._toast.asReadonly();

  private timerId?: ReturnType<typeof setTimeout>;

  /**
   * Shows a toast and auto-dismisses after `durationMs` (or variant default).
   */
  show(message: string, variant: ToastVariant = 'info', durationMs?: number): void {
    this.clearTimer();
    const duration =
      durationMs ??
      (variant === 'error'
        ? DEFAULT_ERROR_MS
        : variant === 'success'
          ? DEFAULT_SUCCESS_MS
          : DEFAULT_INFO_MS);
    this._toast.set({ message, variant });
    this.timerId = globalThis.setTimeout(() => {
      this._toast.set(null);
      this.timerId = undefined;
    }, duration);
  }

  showSuccess(message: string, durationMs = DEFAULT_SUCCESS_MS): void {
    this.show(message, 'success', durationMs);
  }

  showError(message: string, durationMs = DEFAULT_ERROR_MS): void {
    this.show(message, 'error', durationMs);
  }

  showInfo(message: string, durationMs = DEFAULT_INFO_MS): void {
    this.show(message, 'info', durationMs);
  }

  dismiss(): void {
    this.clearTimer();
    this._toast.set(null);
  }

  private clearTimer(): void {
    if (this.timerId !== undefined) {
      globalThis.clearTimeout(this.timerId);
      this.timerId = undefined;
    }
  }
}
