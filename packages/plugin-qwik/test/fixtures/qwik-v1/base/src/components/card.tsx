import { component$ } from '@builder.io/qwik';

export interface CardProps {
  title: string;
}

export const Card = component$<CardProps>((props) => <div>{props.title}</div>);
