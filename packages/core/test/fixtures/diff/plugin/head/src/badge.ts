import { View } from './framework';

@View({ template: './badge.tpl' })
export class Badge {
  text = 'new';
  count = 3;
}
