// bun's own test runner (bun test tests/); its types are not installed.
declare module "bun:test" {
  export const describe: (name: string, fn: () => void) => void;
  export const test: (name: string, fn: () => void) => void;
  export const expect: (value: unknown) => any;
}
