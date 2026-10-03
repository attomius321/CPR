import { component$ } from '@builder.io/qwik';

export const Pill = component$((props: { text: string; size?: number }) => (
  <i data-size={props.size}>{props.text}</i>
));
