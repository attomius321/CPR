import { component$ } from '@qwik.dev/core';

// Qwik 2 renders `404` and `error` pages only: this is not a route.
export default component$(() => <p>server error</p>);
