import Root from './root';

export default function render(options: { base?: string }) {
  return [Root, options.base];
}
