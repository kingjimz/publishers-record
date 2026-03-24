import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { OnboardingWelcomeComponent } from '../components/onboarding-welcome/onboarding-welcome.component';
import { OnboardingService } from '../services/onboarding.service';
import { SupabaseService } from '../services/supabase.service';
import { layoutRouteAnimations } from '../animations/layout-route.animations';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    OnboardingWelcomeComponent,
  ],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.css',
  animations: [layoutRouteAnimations],
})
export class LayoutComponent implements OnInit {
  readonly supabase: SupabaseService;
  protected readonly onboarding = inject(OnboardingService);
  private readonly router = inject(Router);

  /**
   * Animation key synced from the router on NavigationEnd — avoids NG0100 when the
   * outlet activates between dev-mode CD checks (direct `routeAnimation(outlet)` reads).
   */
  protected readonly routeAnimKey = signal('');

  headerMenuOpen = false;

  constructor(supabaseService: SupabaseService) {
    this.supabase = supabaseService;

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.routeAnimKey.set(this.animationKeyFromRouter());
      });
  }

  async ngOnInit(): Promise<void> {
    await this.supabase.ensureSession();
    this.onboarding.tryAutoOpen();
    this.routeAnimKey.set(this.animationKeyFromRouter());
  }

  toggleHeaderMenu(): void {
    this.headerMenuOpen = !this.headerMenuOpen;
  }

  closeHeaderMenu(): void {
    this.headerMenuOpen = false;
  }

  async onSignOut(): Promise<void> {
    this.closeHeaderMenu();
    await this.supabase.signOut();
  }

  /** Deepest activated route’s `data.animation` (same intent as RouterOutlet.activatedRouteData). */
  private animationKeyFromRouter(): string {
    let route = this.router.routerState.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    const key = route.snapshot.data['animation'];
    return typeof key === 'string' ? key : '';
  }
}
