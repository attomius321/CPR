import * as users from './user';

export function describeUser(user: users.User): string {
  return users.formatUser(user);
}
