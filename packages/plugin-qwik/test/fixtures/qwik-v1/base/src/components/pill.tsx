import { component$ } from '@builder.io/qwik';

export const Pill = component$((props: { text: string }) => <i>{props.text}</i>);
