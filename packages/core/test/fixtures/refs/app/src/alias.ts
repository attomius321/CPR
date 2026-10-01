import { formatUser } from '@app/user';

export const describe = (id: string) => formatUser({ id, name: id });
