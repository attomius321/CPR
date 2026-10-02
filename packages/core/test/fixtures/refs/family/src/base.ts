export interface Panel {
  panelDisplayType: string;
}

export interface OnInit {
  ngOnInit(): void;
}

export abstract class ResourceBase implements Panel {
  panelDisplayType = 'side';

  describe(): string {
    return `panel: ${this.panelDisplayType}`;
  }
}
