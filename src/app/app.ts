import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { ToastContainerComponent } from './components/toast-container/toast-container.component';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  constructor() {
    inject(ThemeService);
  }
}
