import { Component } from '@angular/core';
import { AuthService } from './auth.service';
import { BadgeComponent } from './badge.component';
import { BaseComponent } from './base.component';
import { CardComponent } from './card.component';
import { Item } from './item';

@Component({
  selector: 'app-article',
  templateUrl: './article.component.html',
  imports: [BadgeComponent, CardComponent],
  host: { '(document:keydown)': 'onKey($event)' },
})
export class ArticleComponent extends BaseComponent {
  override label = 'article!';
  title = 'Hello';
  query = '';
  count = 0;
  name = 'member';
  items: Item[] = [];

  constructor(public auth: AuthService) {
    super();
  }

  ngOnInit(): void {
    this.count = this.items.length;
  }

  save(): void {
    this.count++;
  }

  toggle(): void {
    this.loading = !this.loading;
  }

  onKey(event: KeyboardEvent): void {
    void event;
  }
}
