import { Component } from '@angular/core';

@Component({
  selector: 'app-badge',
  template: `<b (click)="hit()">{{ text }} ({{ hits }})</b>`,
})
export class BadgeComponent {
  text = 'new';
  hits = 0;

  hit(): void {
    this.hits++;
  }
}
