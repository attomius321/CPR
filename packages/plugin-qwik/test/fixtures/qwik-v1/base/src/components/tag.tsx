import { component$ } from '@builder.io/qwik';

export default component$((props: { name: string; color?: string }) => (
  <b style={{ color: props.color }}>{props.name}</b>
));
