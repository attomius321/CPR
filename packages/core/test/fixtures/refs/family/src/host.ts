import type { ResourceBase } from './base';
import type { CbsComponent } from './cbs';
import type { RentCarsResourceComponent } from './rent-cars';

export class HostComponent {
  constructor(
    private cbs: CbsComponent,
    private rent: RentCarsResourceComponent,
  ) {}

  show(): string {
    return this.cbs.panelDisplayType;
  }

  rentMode(): string {
    return this.rent.panelDisplayType;
  }
}

export function modes(items: ResourceBase[]): string[] {
  return items.map((item) => item.panelDisplayType);
}
