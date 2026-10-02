import { Component } from '@angular/core';

@Component({ selector: 'app-table', templateUrl: './table.component.html' })
export class TableComponent<T> {
  rows: T[] = [];
}
