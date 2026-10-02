import { Component } from '@angular/core';
import type { Article } from './article';

@Component({ selector: 'app-parent', templateUrl: './parent.component.html' })
export class ParentComponent {
  article: Article = { title: 'Hello', body: '# Hello' };
  isSelected = false;

  onToggle(value: boolean): void {
    this.isSelected = value;
  }

  onClosed(): void {
    this.isSelected = false;
  }
}
