import { CommonModule } from '@angular/common';
import { Component, HostListener, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { OnboardingService } from '../../services/onboarding.service';

@Component({
  selector: 'app-onboarding-welcome',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './onboarding-welcome.component.html',
  styleUrl: './onboarding-welcome.component.css',
})
export class OnboardingWelcomeComponent {
  protected readonly onboarding = inject(OnboardingService);

  protected step = 0;
  protected readonly stepCount = 6;

  protected readonly stepLabels = [
    'Why records first',
    'Service year',
    'Add a publisher',
    'New service year',
    'Search',
    'Reports & print',
  ] as const;

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.onboarding.dialogOpen()) {
      this.onboarding.onDismissOverlay();
    }
  }

  @HostListener('document:keydown.arrowleft', ['$event'])
  onArrowLeft(ev: Event): void {
    if (!this.onboarding.dialogOpen()) return;
    ev.preventDefault();
    this.prevStep();
  }

  @HostListener('document:keydown.arrowright', ['$event'])
  onArrowRight(ev: Event): void {
    if (!this.onboarding.dialogOpen()) return;
    ev.preventDefault();
    this.nextStep();
  }

  protected nextStep(): void {
    if (this.step < this.stepCount - 1) {
      this.step++;
    }
  }

  protected prevStep(): void {
    if (this.step > 0) {
      this.step--;
    }
  }

  protected goToStep(index: number): void {
    if (index >= 0 && index < this.stepCount) {
      this.step = index;
    }
  }

  protected get isFirstStep(): boolean {
    return this.step === 0;
  }

  protected get isLastStep(): boolean {
    return this.step === this.stepCount - 1;
  }

  protected onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).dataset['backdrop'] === 'true') {
      this.onboarding.onDismissOverlay();
    }
  }
}
