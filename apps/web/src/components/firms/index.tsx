import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, BookOpen, Users } from "lucide-react";
import * as Firms from "@open-erp/contracts/firms";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { SelectControl } from "@open-erp/ui/components/select";
import {
  Workspace,
  WorkspaceBrand,
  WorkspaceHeader,
  WorkspaceNavLink,
} from "@open-erp/ui/components/workspace";
import {
  PageContent,
  PageEmpty,
  PageCaption,
  RegisterFilter,
} from "@open-erp/ui/components/accounting-page";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@open-erp/ui/components/tabs";
import { SignOut } from "@/components/accounting-access";
import { AccountingStatus } from "@/components/accounting-status";
import { LanguagePreference } from "@/components/book-workspace";
import { readAccounting, type Books } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { formText, FirmForm } from "./form";
import { FirmPortfolio, type PortfolioFilters } from "./portfolio";
import { FirmTeam } from "./team";

export function FirmsWorkspace(props: {
  books: typeof Books.Type;
  locale: Locale;
  firmId?: string;
  tab: "clients" | "team";
  filters: PortfolioFilters;
  onFilters: (filters: PortfolioFilters) => void;
  onNavigate: (firmId: string, tab: "clients" | "team") => void;
}) {
  const { locale } = props;
  const sv = locale === "sv";
  const [creating, setCreating] = useState(false);
  const firms = useQuery({
    queryKey: ["accounting", "firms"],
    queryFn: ({ signal }) => readAccounting("/api/v1/firms", Firms.FirmList, { signal }),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    gcTime: 0,
  });
  const current = props.firmId ?? firms.data?.[0]?.id;
  const workspace = useQuery({
    queryKey: ["accounting", "firms", current],
    enabled: Boolean(current) && firms.isSuccess,
    queryFn: ({ signal }) =>
      readAccounting(`/api/v1/firms/${current}`, Firms.Workspace, { signal }),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    gcTime: 0,
  });
  const known = firms.isSuccess && firms.isFetchedAfterMount;
  const ready =
    known &&
    workspace.isSuccess &&
    workspace.isFetchedAfterMount &&
    workspace.data.firm.id === current;
  return (
    <Workspace
      pageKey="firms"
      mobileNavigation={null}
      brand={<WorkspaceBrand icon={<BookOpen size={20} strokeWidth={1.5} />} name="OpenERP" />}
      navigation={
        <>
          <WorkspaceNavLink href="/companies">
            <Building2 size={16} strokeWidth={1.5} />
            {sv ? "Företag" : "Companies"}
          </WorkspaceNavLink>
          <WorkspaceNavLink href="/firms" active>
            <Users size={16} strokeWidth={1.5} />
            {sv ? "Byrå" : "Firm"}
          </WorkspaceNavLink>
        </>
      }
      footer={
        <Box display="grid" gap="lg" padding="md">
          <LanguagePreference locale={locale} />
          <SignOut locale={locale} />
        </Box>
      }
    >
      <WorkspaceHeader
        title={ready ? workspace.data.firm.name : sv ? "Byrå" : "Firm"}
        action={
          known ? (
            <FirmPicker
              firms={firms.data}
              current={current}
              locale={locale}
              onSelect={(firmId) => props.onNavigate(firmId, "clients")}
              onCreate={() => setCreating(true)}
            />
          ) : undefined
        }
      />
      <PageContent>
        <AccountingStatus
          locale={locale}
          pending={firms.isPending || (known && Boolean(current) && workspace.isPending)}
          error={firms.error ?? (current ? workspace.error : null)}
        />
        {firms.isError || (current && workspace.isError) ? (
          <Button
            variant="outline"
            onClick={() => {
              void firms.refetch();
              if (current) void workspace.refetch();
            }}
          >
            {sv ? "Försök igen" : "Try again"}
          </Button>
        ) : null}

        {known && !current ? (
          <PageEmpty
            title={
              sv ? "En arbetsplats för byråns klienter" : "A workspace for your firm's clients"
            }
            detail={
              sv
                ? "Samla klienter, fördela ansvar och planera avstämningar. Skapa en byrå för att börja."
                : "Bring clients together, assign responsibility and plan reviews. Create a firm to get started."
            }
          />
        ) : null}
        {ready ? (
          <Tabs
            key={current}
            value={props.tab}
            onValueChange={(value) =>
              props.onNavigate(workspace.data.firm.id, value === "team" ? "team" : "clients")
            }
          >
            <TabsList>
              <TabsTrigger value="clients">{sv ? "Klienter" : "Clients"}</TabsTrigger>
              <TabsTrigger value="team">Team</TabsTrigger>
            </TabsList>
            <TabsContent value="clients">
              <FirmPortfolio
                workspace={workspace.data}
                books={props.books}
                locale={locale}
                filters={props.filters}
                onFilters={props.onFilters}
              />
            </TabsContent>
            <TabsContent value="team">
              <FirmTeam workspace={workspace.data} locale={locale} />
            </TabsContent>
          </Tabs>
        ) : null}
      </PageContent>
      {creating ? (
        <CreateFirmDialog
          locale={locale}
          onClose={() => setCreating(false)}
          onSaved={(firmId) => props.onNavigate(firmId, "clients")}
        />
      ) : null}
    </Workspace>
  );
}

function FirmPicker(props: {
  firms: typeof Firms.FirmList.Type;
  current?: string;
  locale: Locale;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const sv = props.locale === "sv";
  return (
    <Box display="flex" gap="md" alignItems="center" justifyContent="between">
      {props.firms.length > 1 ? (
        <RegisterFilter>
          <SelectControl
            aria-label={sv ? "Välj byrå" : "Choose firm"}
            value={props.current ?? ""}
            options={props.firms.map((firm) => ({ value: firm.id, label: firm.name }))}
            onValueChange={(value) => {
              if (value) props.onSelect(value);
            }}
          />
        </RegisterFilter>
      ) : null}
      <Button static variant="ghost" onClick={props.onCreate}>
        {sv ? "Skapa byrå" : "Create firm"}
      </Button>
    </Box>
  );
}
function CreateFirmDialog(props: {
  locale: Locale;
  onClose: () => void;
  onSaved: (firmId: string) => void;
}) {
  const sv = props.locale === "sv";
  return (
    <FirmForm
      title={sv ? "Skapa byrå" : "Create firm"}
      label={sv ? "Skapa byrå" : "Create firm"}
      path="/api/v1/firms"
      schema={Firms.CreateFirm}
      input={(fields) => ({ name: formText(fields, "name").trim() })}
      locale={props.locale}
      onClose={props.onClose}
      onSaved={(result) => props.onSaved(result.firmId)}
    >
      <InputField name="name" label={sv ? "Byråns namn" : "Firm name"} required maxLength={100} />
      <PageCaption>
        {sv
          ? "Du blir administratör och kan lägga till befintliga klienter och kollegor."
          : "You'll be the administrator and can add existing clients and colleagues."}
      </PageCaption>
    </FirmForm>
  );
}
