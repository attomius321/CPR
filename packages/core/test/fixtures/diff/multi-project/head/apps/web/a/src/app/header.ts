import { UserService } from 'src/app/core/user.service';

export function title(users: UserService): string {
  return users.fullName().toUpperCase();
}
