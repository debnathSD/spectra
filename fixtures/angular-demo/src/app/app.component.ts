import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClockComponent } from './clock.component';
import { RowComponent } from './row.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ClockComponent, RowComponent],
  template: `
    <main style="font-family: system-ui; padding: 20px;">
      <h1>Angular Demo</h1>
      <button id="bump" (click)="bump()">Bump ({{ tick }})</button>
      <app-clock></app-clock>
      <ul><app-row *ngFor="let it of items" [item]="it"></app-row></ul>
    </main>
  `,
})
export class AppComponent {
  tick = 0;
  items = Array.from({ length: 30 }, (_, i) => ({ id: i, label: 'Item ' + i }));
  bump() { this.tick++; }
}
