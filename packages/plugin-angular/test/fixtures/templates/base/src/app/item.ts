export class Item {
  constructor(
    public id: number,
    public name: string,
  ) {}

  reload(): void {
    this.name = this.name.trim();
  }
}
