declare module "vitest" {
  interface Assertion {
    toHaveNoViolations(): void;
  }
}

export {};
