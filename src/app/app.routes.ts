import { Routes } from '@angular/router';

import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./components/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./components/forgot-password/forgot-password.component').then(
        (m) => m.ForgotPasswordComponent
      ),
  },
  {
    path: '',
    loadComponent: () =>
      import('./components/module-selector/module-selector.component').then(
        (m) => m.ModuleSelectorComponent
      ),
    canActivate: [authGuard],
    pathMatch: 'full',
    data: { animation: 'ModuleSelectorPage' },
  },
  {
    path: '',
    loadComponent: () => import('./layout/layout.component').then((m) => m.LayoutComponent),
    canActivate: [authGuard],
    children: [
      {
        path: 'publishers-record',
        children: [
          {
            path: 'dashboard',
            loadComponent: () =>
              import('./components/dashboard/dashboard.component').then((m) => m.DashboardComponent),
            data: { animation: 'DashboardPage', tool: 'publishers-record' },
          },
          {
            path: 'add-records',
            loadComponent: () =>
              import('./components/add-records/add-records.component').then(
                (m) => m.AddRecordsComponent
              ),
            data: { animation: 'AddRecordsPage', tool: 'publishers-record' },
          },
          {
            path: 'search-records',
            loadComponent: () =>
              import('./components/search-records/search-records.component').then(
                (m) => m.SearchRecordsComponent
              ),
            data: { animation: 'SearchPage', tool: 'publishers-record' },
          },
          { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
        ],
      },
      {
        path: 'attendance',
        loadComponent: () =>
          import('./components/attendance/attendance.component').then((m) => m.AttendanceComponent),
        data: { animation: 'AttendancePage', tool: 'attendance' },
      },
    ],
  },
  {
    path: '**',
    loadComponent: () =>
      import('./components/not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];
