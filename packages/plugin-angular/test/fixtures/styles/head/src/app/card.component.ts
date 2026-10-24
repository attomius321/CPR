import { Component } from '@angular/core';

@Component({
  selector: 'app-card',
  templateUrl: './card.component.html',
  styleUrls: ['./card.component.scss'],
  host: { class: 'card-host', '[class.open]': 'on' },
})
export class CardComponent {
  on = true;
}
