import { component$ } from '@builder.io/qwik';

export const Badge = component$((props: { label: string }) => <span>{props.label}</span>);
