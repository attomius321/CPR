import { component$, Slot } from '@builder.io/qwik';
import type { RequestHandler } from '@builder.io/qwik-city';

export const onRequest: RequestHandler = async ({ next }) => {
  await next();
};

export default component$(() => (
  <main>
    <Slot />
  </main>
));
