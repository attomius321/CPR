import { component$ } from '@builder.io/qwik';

export const Term = component$((props: { id: string }) => <dfn>{props.id}</dfn>);
