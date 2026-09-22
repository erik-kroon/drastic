import { useRef, useState } from "react";
import { createFileRoute, useHydrated } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingWorkspace } from "@/components/accounting-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { Books, booksKey, readAccounting } from "@/lib/accounting-api";
import { authClient } from "@/lib/auth-client";
import { accountingCopy } from "@/lib/accounting-copy";
import { usePageLocale } from "@/lib/use-page-locale";
import { setLocale, type Locale } from "@/paraglide/runtime";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  const locale = usePageLocale();
  const copy = accountingCopy(locale);
  const hydrated = useHydrated();
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const books = useQuery({
    queryKey: booksKey,
    enabled: hydrated,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        return await readAccounting("/api/v1/books", Books, { signal });
      } catch (error) {
        if (error instanceof Accounting.AccountingError && error.code === "Unauthorized")
          return null;
        throw error;
      }
    },
  });
  const logout = useMutation({
    mutationFn: async () => {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message ?? "Sign-out failed.");
    },
    onSuccess: async () => {
      await client.cancelQueries();
      client.clear();
      client.setQueryData(booksKey, null);
      setSelected(null);
    },
  });
  const book = books.data?.find((item) => `${item.entityId}/${item.id}` === selected);
  return (
    <Box
      maxWidth="wide"
      centered
      paddingInline="lg"
      paddingBlock="2xl"
      display="grid"
      gap="2xl"
      minWidth="zero"
    >
      <Box
        as="header"
        display="flex"
        flexWrap="wrap"
        alignItems="center"
        justifyContent="between"
        gap="lg"
      >
        <Text>OpenERP</Text>
        <Box as="nav" aria-label={copy.language_label} display="flex" flexWrap="wrap" gap="sm">
          <Button
            size="xl"
            variant="ghost"
            aria-pressed={locale === "en"}
            onClick={() => {
              void setLocale("en");
            }}
          >
            English
          </Button>
          <Button
            size="xl"
            variant="ghost"
            aria-pressed={locale === "sv"}
            onClick={() => {
              void setLocale("sv");
            }}
          >
            Svenska
          </Button>
          {books.data ? (
            <Button
              size="xl"
              variant="outline"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              {copy.journal_logout}
            </Button>
          ) : null}
        </Box>
      </Box>
      <Box as="main" display="grid" gap="2xl" minWidth="zero">
        <Box display="grid" gap="md">
          <Heading level={1}>{copy.journal_title}</Heading>
          <Text tone="muted">{copy.journal_intro}</Text>
        </Box>
        <Box padding="lg" backgroundColor="muted" borderRadius="surface">
          <Text>{copy.journal_warning}</Text>
        </Box>
        <AccountingStatus
          locale={locale}
          pending={books.isPending}
          error={books.error ?? logout.error}
        />
        {books.isError ? (
          <Box>
            <Button
              size="xl"
              variant="outline"
              onClick={() => {
                void books.refetch();
              }}
            >
              {copy.journal_retry}
            </Button>
          </Box>
        ) : null}
        {books.data === null ? <Login locale={locale} /> : null}
        {books.data?.length === 0 ? <Text>{copy.journal_no_books}</Text> : null}
        {books.data && books.data.length > 0 ? (
          <>
            <SelectField
              label={copy.journal_book}
              placeholder={copy.journal_choose}
              value={selected}
              onValueChange={setSelected}
              options={books.data.map((item) => ({
                value: `${item.entityId}/${item.id}`,
                label: `${item.name} · ${item.currency} · ${item.entityId}/${item.id}`,
              }))}
            />
            <Text tone="muted">{copy.journal_leave}</Text>
            {book ? (
              <AccountingWorkspace
                key={`${book.entityId}/${book.id}`}
                book={book}
                locale={locale}
              />
            ) : null}
          </>
        ) : null}
      </Box>
    </Box>
  );
}

function Login({ locale }: { locale: Locale }) {
  const copy = accountingCopy(locale);
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const login = useMutation({
    mutationFn: async () => {
      const value = password.current?.value ?? "";
      if (password.current) password.current.value = "";
      const result = await authClient.signIn.email({
        email: email.current?.value.trim() ?? "",
        password: value,
      });
      if (result.error) throw new Error(result.error.message ?? "Sign-in failed.");
    },
    onSuccess: async () => {
      await client.cancelQueries();
      await client.resetQueries();
    },
  });
  return (
    <Box
      as="form"
      maxWidth="content"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        login.mutate();
      }}
    >
      <Heading>{copy.journal_login}</Heading>
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
