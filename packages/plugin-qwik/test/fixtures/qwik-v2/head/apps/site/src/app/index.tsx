import { component$ } from '@qwik.dev/core';
import { routeLoader$ } from '@qwik.dev/router';
import { Button } from '~/components/button';

export const routeConfig = { head: { title: 'Home' } };

export const eTag = 'home-v1';

export const cacheKey = (pathname: string) => pathname;

export const useThing = routeLoader$(() => 42);

// A helper the router does not read: still an orphan.
export const helper = 1;

export default component$(() => <Button label="go" />);
