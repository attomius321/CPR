import { component$ } from '@builder.io/qwik';

// Rendered only by an .mdx route that had no code before.
export const Quote = component$((props: { by: string }) => <q>{props.by}</q>);
