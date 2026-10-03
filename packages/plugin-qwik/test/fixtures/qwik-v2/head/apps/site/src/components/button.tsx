import { component$ as c$ } from '@qwik.dev/core';

export const Button = c$((props: { label: string; kind?: 'primary' | 'plain' }) => (
  <button class={props.kind}>{props.label}</button>
));
