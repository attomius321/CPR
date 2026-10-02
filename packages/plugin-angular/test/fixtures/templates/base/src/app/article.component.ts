import { Component } from '@angular/core';
import { AuthService } from './auth.service';
import { BadgeComponent } from './badge.component';
import { BaseComponent } from './base.component';
import { Item } from './item';

@Component({
  selector: 'app-article',
  templateUrl: './article.component.html',
  imports: [BadgeComponent],
})
export class ArticleComponent extends BaseComponent {
  override label = 'article';
  title = 'Hello';
  query = '';
  count = 0;
  name = 'member';
  items: Item[] = [];

  constructor(public auth: AuthService) {
    super();
  }

  save(): void {
    this.count++;
  }

  remove(): void {
    this.items = [];
  }
}
