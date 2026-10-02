import { Directive, Input, TemplateRef, ViewContainerRef } from '@angular/core';

@Directive({ selector: '[ifAuthenticated]' })
export class IfAuthenticatedDirective {
  constructor(
    private readonly template: TemplateRef<unknown>,
    private readonly container: ViewContainerRef,
  ) {}

  @Input() set ifAuthenticated(show: boolean) {
    if (show) this.container.createEmbeddedView(this.template);
  }
}
