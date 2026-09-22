export interface E2EEnvironment {
  baseUrl: string;
  adminUrl: string;
  runtimeUrl: string;
  artifacts: string;
  scratch: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    e2e: E2EEnvironment;
  }
}
