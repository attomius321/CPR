import { UserService } from '@app/core/user.service';

export function label(users: UserService): string {
  return users.fullName();
}
