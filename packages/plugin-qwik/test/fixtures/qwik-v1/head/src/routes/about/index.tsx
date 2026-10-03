import { component$ } from '@builder.io/qwik';
import {
  routeAction$,
  routeLoader$,
  type DocumentHead,
  type RequestHandler,
} from '@builder.io/qwik-city';

export const onGet: RequestHandler = async ({ cacheControl }) => {
  cacheControl({ maxAge: 5 });
};

export const useAbout = routeLoader$(() => 'about');

export const useSave = routeAction$(() => ({ ok: true }));

export const head: DocumentHead = { title: 'About' };

export const formatTitle = (title: string) => title.toUpperCase();

export default component$(() => <div>about</div>);
