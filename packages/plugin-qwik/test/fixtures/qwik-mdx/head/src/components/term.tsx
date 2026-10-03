import { component$ } from '@builder.io/qwik';

export const Term = component$((props: { id: string; tone: string }) => (
  <dfn class={props.tone}>{props.id}</dfn>
));
