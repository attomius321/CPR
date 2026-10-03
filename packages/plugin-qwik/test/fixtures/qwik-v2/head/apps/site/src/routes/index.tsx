import { component$ } from '@qwik.dev/core';
import type { RequestHandler } from '@qwik.dev/router';

// The routes folder is src/app here (vite.config.ts): nothing calls these.
export const onGet: RequestHandler = async () => {};

export default component$(() => <p>old</p>);
