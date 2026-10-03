import { component$ } from '@builder.io/qwik';

export default component$((props: { name: string }) => <b>{props.name}</b>);
