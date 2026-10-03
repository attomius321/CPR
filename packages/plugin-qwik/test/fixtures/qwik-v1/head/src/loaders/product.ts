import { routeLoader$ } from '@builder.io/qwik-city';

export const useProduct = routeLoader$(() => ({ name: 'x' }));
