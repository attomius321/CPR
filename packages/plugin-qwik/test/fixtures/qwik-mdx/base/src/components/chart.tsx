import { component$ } from '@builder.io/qwik';

export const Chart = component$((props: { data: number[] }) => <svg>{props.data.length}</svg>);
