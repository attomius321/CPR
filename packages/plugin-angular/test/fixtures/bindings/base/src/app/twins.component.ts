import { Component } from '@angular/core';

// Two components with one selector: a compiling app imports only one of them where it is used.
@Component({ selector: 'app-twin', template: '<i>a</i>' })
export class TwinAComponent {
  name = 'a';
}

@Component({ selector: 'app-twin', template: '<i>b</i>' })
export class TwinBComponent {
  name = 'b';
}
