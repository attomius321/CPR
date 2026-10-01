export interface User {
  id: string;
  name: string;
}

export function findUser(users: User[], id: string) {
  return users.find((u) => u.id === id);
}

export function formatUser(user: User): string {
  return `${user.name} (${user.id})`;
}

export function legacyLookup(id: string) {
  return id.trim().toLowerCase();
}

export function unchanged() {
  return 42;
}
