import { Directive, Input } from '@angular/core';

@Directive()
export abstract class BaseCard {
  @Input() theme = 'dark';
}
