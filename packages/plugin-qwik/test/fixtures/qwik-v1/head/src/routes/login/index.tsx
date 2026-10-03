import { component$ } from '@builder.io/qwik';
import { formAction$ } from '@acme/forms';

export const useLogin = formAction$(() => ({ ok: true }));

export default component$(() => <form>login</form>);
