import { routeLoader$ } from '@builder.io/qwik-city';

export const useCart = routeLoader$(() => ({ items: 0 }));

export const cartTotal = (items: number[]) => items.reduce((a, b) => a + b, 0);
