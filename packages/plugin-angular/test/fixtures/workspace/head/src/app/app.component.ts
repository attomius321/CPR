import { Component } from '@angular/core';
import { price } from 'ui-kit';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
})
export class AppComponent {
  total = price(3, 'USD');
}
