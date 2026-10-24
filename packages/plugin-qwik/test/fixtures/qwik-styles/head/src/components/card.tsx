import { component$, useStyles$, useStylesScoped$ } from '@builder.io/qwik';
import scoped from './card.css?inline';
import shared from './shared.css?inline';

export const Card = component$(() => {
  useStylesScoped$(scoped);
  useStyles$(shared);
  return <div class="title chip" />;
});

export const Badge = component$(() => <span class="title chip" />);
