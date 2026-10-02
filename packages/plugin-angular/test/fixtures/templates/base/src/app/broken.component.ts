import { Component } from '@angular/core';

@Component({ selector: 'app-broken', templateUrl: './broken.component.html' })
export class BrokenComponent {
  title = 'Broken';

  save(): void {
    this.title = '';
  }
}
