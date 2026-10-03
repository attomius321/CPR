import { component$ as c$ } from '@qwik.dev/core';

export const Button = c$((props: { label: string }) => <button>{props.label}</button>);
