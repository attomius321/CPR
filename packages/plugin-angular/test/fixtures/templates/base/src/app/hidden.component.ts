import { Component } from '@angular/core';

@Component({ selector: 'app-hidden', template: '<p>{{ x }}</p>' })
class HiddenComponent {
  x = 1;
}

export const hidden = HiddenComponent;
