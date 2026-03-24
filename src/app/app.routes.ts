import { Routes } from '@angular/router';
import { ForgotPasswordComponent } from './components/forgot-password/forgot-password.component';
import { LoginComponent } from './components/login/login.component';
import { NotFoundComponent } from './components/not-found/not-found.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { AddRecordsComponent } from './components/add-records/add-records.component';
import { SearchRecordsComponent } from './components/search-records/search-records.component';
import { LayoutComponent } from './layout/layout.component';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'forgot-password', component: ForgotPasswordComponent },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        component: DashboardComponent,
        data: { animation: 'DashboardPage' },
      },
      {
        path: 'add-records',
        component: AddRecordsComponent,
        data: { animation: 'AddRecordsPage' },
      },
      {
        path: 'search-records',
        component: SearchRecordsComponent,
        data: { animation: 'SearchPage' },
      },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  { path: '**', component: NotFoundComponent },
];
