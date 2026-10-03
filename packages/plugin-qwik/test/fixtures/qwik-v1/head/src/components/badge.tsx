import { component$ } from '@builder.io/qwik';

export const Badge = component$((props: { label: string; tone: string }) => (
  <span class={props.tone}>{props.label}</span>
));
