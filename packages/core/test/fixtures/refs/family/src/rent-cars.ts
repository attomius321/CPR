import { ResourceBase, type OnInit } from './base';

export class RentCarsResourceComponent extends ResourceBase implements OnInit {
  get isPanelOverlay(): boolean {
    return this.panelDisplayType === 'overlay';
  }

  ngOnInit(): void {}

  onAddItem(): void {
    this.panelDisplayType = 'overlay';
  }
}
