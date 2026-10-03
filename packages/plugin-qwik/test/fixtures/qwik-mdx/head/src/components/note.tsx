import { component$, Slot } from '@builder.io/qwik';

export const Note = component$((props: { kind: string; title: string }) => (
  <aside class={props.kind} title={props.title}>
    <Slot />
  </aside>
));
