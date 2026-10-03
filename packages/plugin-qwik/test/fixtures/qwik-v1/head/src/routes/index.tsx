import { component$ } from '@builder.io/qwik';
import { routeLoader$ } from '@builder.io/qwik-city';
import { Badge } from '~/components/badge';
import { Card } from '~/components/card';
import { Pill } from '~/components/pill';
import Tag from '~/components/tag';
import { Widget } from '~/components/widget';

export const useData = routeLoader$(() => 1);

export default component$(() => {
  const data = useData();
  return (
    <div>
      <Card title="a" />
      <Badge label="b" />
      <Pill text="c" />
      <Tag name="d" color="red" />
      <Widget />
      {data.value}
    </div>
  );
});
