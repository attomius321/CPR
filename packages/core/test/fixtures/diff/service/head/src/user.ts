export interface User {
  id: string;
  name: string;
  email?: string;
}

export function findUser(users: User[], id: string) {
  return users.find((u) => u.id === id) ?? null;
}

export function formatUser(user: User): string {
  return `${user.name} <${user.id}>`;
}

export function unchanged() {
  return 42;
}

export function normalizeId(id: string) {
  return id.trim().toLowerCase();
}

export function greet(user: User) {
  return `hi ${user.name}`;
}
