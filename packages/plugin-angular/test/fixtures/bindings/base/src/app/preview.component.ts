import { Component, EventEmitter, Input, Output, input, model } from '@angular/core';
import type { Article } from './article';
import { BaseCard } from './base-card';

@Component({
  selector: 'app-preview',
  template: '<p>{{ article()?.title }}</p>',
  exportAs: 'appPreview',
})
export class PreviewComponent extends BaseCard {
  article = input<Article>();
  count = input(0, { alias: 'total' });
  selected = model(false);
  @Input() label = '';
  @Input() size: number = 1;
  @Output('toggle') toggled = new EventEmitter<boolean>();
  @Output() closed = new EventEmitter<void>();

  reload(): void {
    this.toggled.emit(true);
  }
}
