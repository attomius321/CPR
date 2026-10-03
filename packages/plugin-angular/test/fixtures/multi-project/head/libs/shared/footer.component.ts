import { Component } from '@angular/core';

@Component({ selector: 'app-footer', template: '<footer>{{ year }}</footer>' })
export class FooterComponent {
  year = 2026;
}
