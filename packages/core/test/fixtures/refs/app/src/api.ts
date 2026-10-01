import { UserService, fmt } from './index';

export function handler(id: string): string {
  const service = UserService.create();
  return fmt(service.getUser(id));
}

export class AdminService extends UserService {}

handler('boot');
