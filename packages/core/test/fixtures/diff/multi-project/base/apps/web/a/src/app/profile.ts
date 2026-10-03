import { UserService } from '@app/core/user.service';

export function greet(users: UserService): string {
  return `Hello ${users.fullName()}`;
}
