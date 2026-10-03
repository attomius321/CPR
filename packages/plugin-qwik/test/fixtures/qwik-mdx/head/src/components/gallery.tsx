import { component$ } from '@builder.io/qwik';

// Rendered only by an .mdx route.
export const Gallery = component$((props: { images: string[] }) => <div>{props.images.length}</div>);
