export interface E2EEnvironment {
  baseUrl: string;
  processorFixtureUrl: string;
  processorFixtureSecret: string;
  documentFixtureUrl: string;
  documentFixtureSecret: string;
  documentFixtureServiceToken: string;
  peppolFixtureUrl: string;
  peppolFixtureSecret: string;
  peppolFixtureProviderAccount: string;
  peppolFixtureReleaseSha256: string;
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
