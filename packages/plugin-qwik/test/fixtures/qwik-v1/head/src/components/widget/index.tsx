import { component$ } from '@builder.io/qwik';
import type { RequestHandler } from '@builder.io/qwik-city';

// Not a route: the router never calls this.
export const onGet: RequestHandler = async () => {};

export const Widget = component$(() => <aside>widget</aside>);
