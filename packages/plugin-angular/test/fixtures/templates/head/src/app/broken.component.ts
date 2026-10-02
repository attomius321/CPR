import { Component } from '@angular/core';

@Component({ selector: 'app-broken', templateUrl: './broken.component.html' })
export class BrokenComponent {
  title = 'Still broken';

  save(): void {
    this.title = '';
  }
}
