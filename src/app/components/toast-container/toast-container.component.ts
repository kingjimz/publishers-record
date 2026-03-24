import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';

import { ToastService, ToastVariant } from '../../services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast-container.component.html',
  styleUrl: './toast-container.component.css',
})
export class ToastContainerComponent {
  protected readonly toastService = inject(ToastService);

  protected variantClass(v: ToastVariant): string {
    switch (v) {
      case 'success':
        return 'border-emerald-200 bg-emerald-50 text-emerald-900';
      case 'error':
        return 'border-red-200 bg-red-50 text-red-900';
      default:
        return 'border-primary-200 bg-primary-50 text-primary-900';
    }
  }
}
