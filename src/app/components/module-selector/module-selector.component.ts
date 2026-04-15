import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-module-selector',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './module-selector.component.html',
  styleUrl: './module-selector.component.css',
})
export class ModuleSelectorComponent {}
