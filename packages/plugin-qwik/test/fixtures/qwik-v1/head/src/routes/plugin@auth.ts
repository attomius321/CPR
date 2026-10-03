import type { RequestHandler } from '@builder.io/qwik-city';

export const onRequest: RequestHandler = async ({ next }) => {
  await next();
};

// Server plugins only have request handlers: nothing calls this.
export const secret = 'x';
