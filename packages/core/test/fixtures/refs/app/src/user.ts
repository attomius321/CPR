export interface User {
  id: string;
  name: string;
}

export class UserService {
  private users: User[] = [];

  static create(): UserService {
    return new UserService();
  }

  getUser(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }
}

export function formatUser(user: User | undefined): string {
  return user ? user.name : 'nobody';
}
