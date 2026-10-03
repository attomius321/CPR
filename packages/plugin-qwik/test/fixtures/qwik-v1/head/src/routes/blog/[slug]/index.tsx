import { component$ } from '@builder.io/qwik';
import type { StaticGenerateHandler } from '@builder.io/qwik-city';

export const onStaticGenerate: StaticGenerateHandler = () => ({ params: [{ slug: 'hello' }] });

export default component$(() => <article>post</article>);
