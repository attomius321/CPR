declare namespace JSX {
  interface IntrinsicElements {
    [name: string]: { className?: string; style?: Record<string, string> };
  }
}
declare module '*.module.css' {
  const classes: { readonly [name: string]: string };
  export default classes;
}
