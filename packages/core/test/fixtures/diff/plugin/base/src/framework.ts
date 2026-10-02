/** A made-up UI framework: a class decorated with `@View` renders its `.tpl` template. */
export interface ViewOptions {
  template: string;
  tags?: string[];
}

export function View(options: ViewOptions) {
  return <T>(target: T): T => {
    void options;
    return target;
  };
}
