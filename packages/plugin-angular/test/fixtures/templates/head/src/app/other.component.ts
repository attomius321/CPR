import { Component } from '@angular/core';
import { BaseComponent } from './base.component';

@Component({ selector: 'app-other', templateUrl: './other.component.html' })
export class OtherComponent extends BaseComponent {
  override label = 'other';
}
