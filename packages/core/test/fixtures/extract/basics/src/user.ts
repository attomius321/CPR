export interface UserDto {
  id: string;
  name?: string;
}

export type UserId = UserDto['id'];

export enum Role {
  Admin,
  Member,
}

/** Loads users. */
export class UserService {
  static instances = 0;
  #cache = new Map<string, UserDto>();
  private readonly prefix: string;

  constructor(prefix: string);
  constructor(prefix: string, extra: number);
  constructor(prefix: string, _extra?: number) {
    this.prefix = prefix;
  }

  get size() {
    return this.#cache.size;
  }
  set size(value: number) {
    void value;
  }

  async getUser(id: UserId): Promise<UserDto | undefined> {
    return this.#cache.get(this.prefix + id);
  }

  static create() {
    return new UserService('u:');
  }

  create(): UserDto {
    return { id: 'x' };
  }

  handle = (event: string) => event.length;

  [Symbol.iterator]() {
    return this.#cache.values();
  }
}

export function parse(input: string): number;
export function parse(input: number): number;
export function parse(input: string | number) {
  return Number(input);
}

export const double = (n: number) => n * 2;
export const config = { retries: 3 };
const { a, b: [c] } = { a: 1, b: [2] };
let counter = 0;

function helper() {
  return counter++ + a + c;
}

export namespace Utils {
  export function slugify(s: string) {
    return s.toLowerCase();
  }
  function hidden() {}
  export namespace Deep.Er {
    export const x = 1;
  }
}

export { helper as publicHelper };

export default function () {
  return helper();
}
