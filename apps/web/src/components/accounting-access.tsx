import { SignInConfiguration } from "@open-erp/contracts/identity";
import { useRef, useState, type ReactNode } from "react";
import * as Accounting from "@open-erp/contracts/accounting";
import { useHydrated } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { Books, booksKey, readAccounting } from "@/lib/accounting-api";
import { authClient } from "@/lib/auth-client";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function AccountingAccess({
  locale,
  children,
}: {
  locale: Locale;
  children: (books: typeof Books.Type) => ReactNode;
}) {
  const hydrated = useHydrated();
  const client = useQueryClient();
  const copy = accountingCopy(locale);

  const [accessBlocked, setAccessBlocked] = useState(
    () => client.getQueryState(booksKey)?.status === "error",
  );

  const books = useQuery<typeof Books.Type | null>({
    queryKey: booksKey,
    enabled: hydrated && client.getQueryData(booksKey) !== null,
    retry: false,
    staleTime: 0,
    queryFn: ({ signal }) => readAccounting("/api/v1/books", Books, { signal }),
  });

  const accessDenied =
    books.error instanceof Accounting.AccountingError &&
    ["Unauthorized", "Forbidden", "NotFound"].includes(books.error.code);

  if ((accessDenied || books.data === null) && !accessBlocked) setAccessBlocked(true);
  else if (accessBlocked && books.data && books.isSuccess && books.fetchStatus === "idle") {
    setAccessBlocked(false);
  }

  if (books.data && !accessBlocked && !accessDenied)
    return (
      <>
        {books.isError ? (
          <Box display="grid" gap="md" padding="lg">
            <AccountingStatus locale={locale} pending={books.isFetching} error={books.error} />
            <Box>
              <Button
                variant="outline"
                disabled={books.isFetching}
                onClick={() => {
                  void books.refetch();
                }}
              >
                {copy.journal_retry}
              </Button>
            </Box>
          </Box>
        ) : null}
        {children(books.data)}
      </>
    );

  return (
    <Box maxWidth="content" centered padding="lg" paddingBlock="2xl" display="grid" gap="xl">
      <Text>OpenERP</Text>
      <AccountingStatus locale={locale} pending={books.isPending} error={books.error} />
      {books.isError ? (
        <Button
          size="xl"
          variant="outline"
          onClick={() => {
            void books.refetch();
          }}
        >
          {copy.journal_retry}
        </Button>
      ) : null}
      {books.data === null ? <Login locale={locale} /> : null}
    </Box>
  );
}

function Login({ locale }: { locale: Locale }) {
  const sv = locale === "sv";

  const configuration = useQuery({
    queryKey: ["sign-in-configuration"],
    queryFn: ({ signal }) =>
      readAccounting("/api/auth/configuration", SignInConfiguration, { signal }),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const sso = useMutation({
    mutationFn: async () => {
      if (!configuration.data?.providerId) throw new Error("Sign-in is not configured.");

      const result = await authClient.signIn.social({
        provider: configuration.data.providerId,
        callbackURL: window.location.origin + window.location.pathname,
        errorCallbackURL: "/companies?authError=1",
      });

      if (result.error)
        throw new Error(
          sv
            ? "Inloggningen kunde inte startas. Försök igen."
            : "Sign-in could not start. Try again.",
        );
    },
  });

  if (configuration.isSuccess && configuration.data.method === "password")
    return <PasswordLogin locale={locale} />;

  return (
    <Box display="grid" gap="lg">
      <Heading level={1}>{sv ? "Logga in på OpenERP" : "Sign in to OpenERP"}</Heading>
      <Text tone="muted">
        {sv
          ? "Fortsätt med ditt organisationskonto för att öppna dina företag och klienter."
          : "Continue with your organization account to open your companies and clients."}
      </Text>
      {configuration.isError ? (
        <>
          <Text>
            {sv ? "Inloggning är inte tillgänglig just nu." : "Sign-in is currently unavailable."}
          </Text>
          <Button
            variant="outline"
            onClick={() => {
              void configuration.refetch();
            }}
          >
            {sv ? "Försök igen" : "Try again"}
          </Button>
        </>
      ) : null}
      {configuration.isSuccess ? (
        <Box>
          <Button size="xl" disabled={sso.isPending} onClick={() => sso.mutate()}>
            {sv ? "Fortsätt med organisationskonto" : "Continue with organization account"}
          </Button>
        </Box>
      ) : null}
      {new URL(window.location.href).searchParams.has("authError") ? (
        <Text role="alert">
          {sv
            ? "Inloggningen slutfördes inte. Försök igen eller kontakta administratören för åtkomst."
            : "Sign-in did not complete. Try again or contact your administrator for access."}
        </Text>
      ) : null}
      <AccountingStatus
        locale={locale}
        pending={configuration.isPending || sso.isPending}
        error={sso.error}
      />
    </Box>
  );
}

function PasswordLogin({ locale }: { locale: Locale }) {
  const copy = accountingCopy(locale);
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const client = useQueryClient();

  const login = useMutation({
    mutationFn: async () => {
      const gate = client.getQueryCache().find({ queryKey: booksKey, exact: true });
      const value = password.current?.value ?? "";

      if (password.current) password.current.value = "";

      const result = await authClient.signIn.email({
        email: email.current?.value.trim() ?? "",
        password: value,
      });

      if (result.error) throw new Error(result.error.message ?? "Sign-in failed.");

      return gate;
    },
    onSuccess: async (gate) => {
      if (
        !gate ||
        gate.state.data !== null ||
        !Object.is(client.getQueryCache().find({ queryKey: booksKey, exact: true }), gate)
      )
        return;
      await client.cancelQueries();

      if (
        gate.state.data !== null ||
        !Object.is(client.getQueryCache().find({ queryKey: booksKey, exact: true }), gate)
      )
        return;
      await client.resetQueries();
    },
  });

  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        login.mutate();
      }}
    >
      <Heading level={1}>{copy.journal_login}</Heading>
      <Text tone="muted">{copy.journal_login_help}</Text>
      <InputField
        label={copy.journal_email}
        ref={email}
        name="email"
        type="email"
        autoComplete="username"
        maxLength={254}
        required
        disabled={login.isPending}
      />
      <InputField
        label={copy.journal_password}
        ref={password}
        name="password"
        type="password"
        autoComplete="current-password"
        minLength={12}
        maxLength={128}
        required
        disabled={login.isPending}
      />
      <Box>
        <Button size="xl" type="submit" disabled={login.isPending}>
          {copy.journal_login}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={login.isPending} error={login.error} />
    </Box>
  );
}

export function SignOut({ locale }: { locale: Locale }) {
  const client = useQueryClient();
  const copy = accountingCopy(locale);

  const logout = useMutation({
    mutationFn: async () => {
      const gate = client.getQueryCache().find({ queryKey: booksKey, exact: true });
      const result = await authClient.signOut();

      if (result.error) throw new Error(result.error.message ?? "Sign-out failed.");

      return gate;
    },
    onSuccess: async (gate) => {
      if (
        !gate ||
        !Object.is(client.getQueryCache().find({ queryKey: booksKey, exact: true }), gate)
      )
        return;
      await client.cancelQueries();

      if (!Object.is(client.getQueryCache().find({ queryKey: booksKey, exact: true }), gate))
        return;
      // Notify the mounted gate before retiring it, then seed the replacement.
      client.setQueryData(booksKey, null);
      client.clear();
      client.setQueryData(booksKey, null);
    },
  });

  return (
    <Box display="grid" gap="sm">
      <Button
        static
        size="xl"
        variant="ghost"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
      >
        {copy.journal_logout}
      </Button>
      {logout.error ? <Text role="alert">{logout.error.message}</Text> : null}
    </Box>
  );
}
