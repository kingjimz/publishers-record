import { Component } from '@angular/core';

/**
 * Left-hand brand panel shared by the auth pages (login, forgot password).
 * Hidden below the `lg` breakpoint; the pages render a compact header instead.
 */
@Component({
  selector: 'app-auth-brand-panel',
  standalone: true,
  styles: [':host { display: contents; }'],
  template: `
    <aside class="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-primary-700 via-primary-600 to-primary-500 text-white p-12 xl:p-16">
      <!-- Soft depth blobs -->
      <div class="pointer-events-none absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/10 blur-3xl" aria-hidden="true"></div>
      <div class="pointer-events-none absolute -bottom-32 -right-20 w-[28rem] h-[28rem] rounded-full bg-primary-300/20 blur-3xl" aria-hidden="true"></div>

      <!-- Brand -->
      <div class="relative flex items-center gap-3">
        <span class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-white p-1.5 shadow-soft">
          <img src="logo.png" alt="" class="w-full h-full object-contain" />
        </span>
        <div>
          <p class="font-semibold text-white tracking-tight leading-tight">Congregation Tools</p>
          <p class="text-xs text-white/60">Bolaoen Congregation</p>
        </div>
      </div>

      <!-- Message -->
      <div class="relative max-w-md">
        <h2 class="text-3xl xl:text-4xl font-semibold tracking-tight text-white leading-tight">
          One place for your congregation's records.
        </h2>
        <p class="mt-4 text-sm xl:text-base text-white/70 leading-relaxed">
          Keep service reports, attendance and meeting assignments organized, accurate and ready when you need them.
        </p>

        <ul class="mt-10 space-y-4">
          <li class="flex items-center gap-3">
            <span class="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/15 ring-1 ring-white/20">
              <i class="bi bi-people-fill text-base"></i>
            </span>
            <div>
              <p class="text-sm font-medium text-white">Publishers Record</p>
              <p class="text-xs text-white/60">Manage publisher service records</p>
            </div>
          </li>
          <li class="flex items-center gap-3">
            <span class="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/15 ring-1 ring-white/20">
              <i class="bi bi-calendar-check-fill text-base"></i>
            </span>
            <div>
              <p class="text-sm font-medium text-white">Attendance Record</p>
              <p class="text-xs text-white/60">Track and average meeting attendance</p>
            </div>
          </li>
          <li class="flex items-center gap-3">
            <span class="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/15 ring-1 ring-white/20">
              <i class="bi bi-card-checklist text-base"></i>
            </span>
            <div>
              <p class="text-sm font-medium text-white">Meeting Scheduler</p>
              <p class="text-xs text-white/60">Midweek meeting assignments</p>
            </div>
          </li>
        </ul>
      </div>

      <!-- Footer -->
      <p class="relative text-xs text-white/50">&copy; {{ year }} Congregation Tools</p>
    </aside>
  `,
})
export class AuthBrandPanelComponent {
  protected readonly year = new Date().getFullYear();
}
