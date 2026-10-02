import { ResourceBase, type OnInit } from './base';

export class CbsComponent extends ResourceBase implements OnInit {
  override panelDisplayType = 'overlay';

  ngOnInit(): void {
    this.panelDisplayType = 'side';
  }
}

export class SpecialCbsComponent extends CbsComponent {
  override panelDisplayType = 'special';
}
