import { Component, EventEmitter, Input, Output, input, model } from '@angular/core';
import type { Article } from './article';
import { BaseCard } from './base-card';

@Component({
  selector: 'app-preview',
  template: '<p>{{ article()?.title }}</p>',
  exportAs: 'appPreview',
})
export class PreviewComponent extends BaseCard {
  article = input<Article | undefined>(undefined);
  count = input(1, { alias: 'total' });
  selected = model(true);
  @Input() caption = '';
  @Input() size: 'small' | 'large' = 'small';
  @Output('toggle') toggled = new EventEmitter<boolean>();

  reload(): void {
    this.toggled.emit(false);
  }
}
