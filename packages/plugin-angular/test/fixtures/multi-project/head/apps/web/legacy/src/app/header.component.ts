import { Component } from '@angular/core';

@Component({ selector: 'app-header', template: '<h1>{{ title }}</h1>' })
export class HeaderComponent {
  title = 'legacy';
}
