import { Component } from '@angular/core';

@Component({
  selector: 'app-table',
  templateUrl: './table.component.html',
  host: { '[style.minHeight.px]': 'minHeight' },
})
export class TableComponent<T> {
  rows: T[] = [];
  rowHeight = 10;
  minHeight = 50;
}
