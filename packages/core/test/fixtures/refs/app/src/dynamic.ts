export function run(target: any, method: string) {
  target[method]();
  target.go();
}
