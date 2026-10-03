import { component$ } from '@builder.io/qwik';

export { useProduct } from '~/loaders/product';
export * from '~/loaders/cart';

export default component$(() => <div>shop</div>);
