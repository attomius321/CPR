export class UserService {
  private first = 'Ada';
  private last = 'Lovelace';

  displayName(): string {
    return `${this.first} ${this.last}`;
  }
}
