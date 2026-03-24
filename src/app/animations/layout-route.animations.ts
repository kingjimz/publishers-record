import { animate, query, style, transition, trigger } from '@angular/animations';

/**
 * Route outlet transitions inside `LayoutComponent`.
 * Dashboard ↔ Search uses a horizontal slide; other navigations use a soft fade-up.
 */
export const layoutRouteAnimations = trigger('layoutRouteAnimations', [
  transition('void => *', [enterFadeUp()]),
  transition('DashboardPage => SearchPage', [enterFromRight()]),
  transition('SearchPage => DashboardPage', [enterFromLeft()]),
  transition('* => *', [enterFadeUp()]),
]);

/** New page eases in from the right (forward navigation feel). */
function enterFromRight() {
  return query(':enter', [
    style({ opacity: 0, transform: 'translateX(2rem)' }),
    animate(
      '420ms cubic-bezier(0.22, 1, 0.36, 1)',
      style({ opacity: 1, transform: 'none' })
    ),
  ], { optional: true });
}

/** New page eases in from the left (back navigation feel). */
function enterFromLeft() {
  return query(':enter', [
    style({ opacity: 0, transform: 'translateX(-2rem)' }),
    animate(
      '420ms cubic-bezier(0.22, 1, 0.36, 1)',
      style({ opacity: 1, transform: 'none' })
    ),
  ], { optional: true });
}

/** Default: gentle fade + slight rise. */
function enterFadeUp() {
  return query(':enter', [
    style({ opacity: 0, transform: 'translateY(0.75rem)' }),
    animate(
      '340ms cubic-bezier(0.22, 1, 0.36, 1)',
      style({ opacity: 1, transform: 'none' })
    ),
  ], { optional: true });
}
