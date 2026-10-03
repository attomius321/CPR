import { component$, Slot } from '@builder.io/qwik';

export const Note = component$((props: { kind: string }) => (
  <aside class={props.kind}>
    <Slot />
  </aside>
));
