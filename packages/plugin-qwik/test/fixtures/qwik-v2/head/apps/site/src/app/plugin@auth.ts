import type { RequestHandler } from '@qwik.dev/router';

export const onRequest: RequestHandler = async ({ next }) => {
  await next();
};
