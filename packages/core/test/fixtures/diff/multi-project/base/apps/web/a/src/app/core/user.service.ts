export class UserService {
  private first = 'Ada';
  private last = 'Lovelace';

  fullName(): string {
    return `${this.first} ${this.last}`;
  }
}
