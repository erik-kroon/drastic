import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as Onboarding from "@open-erp/contracts/onboarding";
import { AccountingError } from "@open-erp/contracts/accounting";
import { SetupButton, SetupContent } from "@open-erp/ui/components/setup-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { OnboardingStart } from "./start";
import { OnboardingProfile, OnboardingCompatibility } from "./profile";
import { OnboardingWorkspace } from "./workspace";
import { OnboardingSources } from "./sources";
import { OnboardingImport, OnboardingMapping } from "./import";
import { OnboardingOpening, OnboardingVerification } from "./verification";
import { OnboardingResponsibilities } from "./responsibilities";
import {
  OnboardingCutover,
  OnboardingDelta,
  OnboardingActivation,
  OnboardingFirstPeriod,
} from "./transition";
import type { OnboardingView } from "./views";

export function OnboardingPanel({ view }: { view: OnboardingView }) {
  const { book, locale } = useBookWorkspace();
  const navigate = useNavigate();

  const workspace = useQuery({
    queryKey: [...bookKey(book), "onboarding"],
    queryFn: async ({ signal }) => {
      try {
        return await readAccounting(
          `${bookPath(book)}/onboarding`,
          Onboarding.OnboardingWorkspace,
          { signal },
        );
      } catch (error) {
        if (error instanceof AccountingError && error.code === "NotFound") return null;
        throw error;
      }
    },
    retry: false,
  });

  const lifecycle = useQuery({
    queryKey: [...bookKey(book), "onboarding", "lifecycle"],
    enabled: !!workspace.data && view !== "start",
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/onboarding/lifecycle`, Onboarding.OnboardingLifecycle, {
        signal,
      }),
    refetchInterval: (query) =>
      query.state.data?.intents.length && !query.state.data.activation ? 2_000 : false,
    retry: false,
  });

  const open = (next: OnboardingView) => {
    void navigate({
      to: "/entities/$entityId/books/$bookId/setup",
      params: { entityId: book.entityId, bookId: book.id },
      search: { view: next },
    });
  };

  if (workspace.isPending || workspace.isError) {
    return (
      <SetupContent>
        <AccountingStatus locale={locale} pending={workspace.isPending} error={workspace.error} />
        {workspace.isError ? (
          <SetupButton
            type="button"
            variant="outline"
            disabled={workspace.isFetching}
            onClick={() => {
              void workspace.refetch();
            }}
          >
            {locale === "sv" ? "Försök igen" : "Try again"}
          </SetupButton>
        ) : null}
      </SetupContent>
    );
  }

  if (view !== "start" && workspace.data) {
    if (!lifecycle.data)
      return (
        <SetupContent>
          <AccountingStatus locale={locale} pending={lifecycle.isPending} error={lifecycle.error} />
          {lifecycle.isError ? (
            <SetupButton
              variant="outline"
              disabled={lifecycle.isFetching}
              onClick={() => {
                void lifecycle.refetch();
              }}
            >
              Försök igen
            </SetupButton>
          ) : null}
        </SetupContent>
      );

    switch (view) {
      case "profile":
        return <OnboardingProfile workspace={workspace.data} open={open} />;
      case "compatibility":
        return <OnboardingCompatibility workspace={workspace.data} open={open} />;
      case "workspace":
        return (
          <OnboardingWorkspace workspace={workspace.data} lifecycle={lifecycle.data} open={open} />
        );
      case "sources":
        return <OnboardingSources workspace={workspace.data} open={open} />;
      case "import":
        return <OnboardingImport workspace={workspace.data} open={open} />;
      case "mapping":
        return (
          <OnboardingMapping workspace={workspace.data} lifecycle={lifecycle.data} open={open} />
        );
      case "opening":
        return (
          <OnboardingOpening workspace={workspace.data} lifecycle={lifecycle.data} open={open} />
        );
      case "verification":
        return (
          <OnboardingVerification
            workspace={workspace.data}
            lifecycle={lifecycle.data}
            open={open}
          />
        );
      case "responsibilities":
        return (
          <OnboardingResponsibilities
            key={`${book.id}-${lifecycle.data.responsibilities?.revision ?? 0}`}
            lifecycle={lifecycle.data}
            open={open}
            viewerId={lifecycle.data.viewerActorId}
          />
        );
      case "cutover":
        return (
          <OnboardingCutover workspace={workspace.data} lifecycle={lifecycle.data} open={open} />
        );
      case "delta":
        return (
          <OnboardingDelta workspace={workspace.data} lifecycle={lifecycle.data} open={open} />
        );
      case "confirmation":
        return (
          <OnboardingCutover
            workspace={workspace.data}
            lifecycle={lifecycle.data}
            open={open}
            confirmation
          />
        );
      case "activation":
        return <OnboardingActivation lifecycle={lifecycle.data} open={open} />;
      case "first-period":
        return (
          <OnboardingFirstPeriod
            workspace={workspace.data}
            lifecycle={lifecycle.data}
            open={open}
          />
        );
    }
  }

  return (
    <OnboardingStart
      key={workspace.data?.case.id ?? book.id}
      saved={workspace.data?.case ?? null}
      onContinue={() => open("profile")}
      onCancel={() => {
        void navigate({ to: "/companies" });
      }}
      onReload={() => {
        void workspace.refetch();
      }}
    />
  );
}
