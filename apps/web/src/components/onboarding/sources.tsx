import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as stylex from "@stylexjs/stylex";
import * as Intake from "@open-erp/contracts/source-intake";
import * as Onboarding from "@open-erp/contracts/onboarding";
import * as Sie from "@open-erp/contracts/sie-import";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { InputField } from "@open-erp/ui/components/field";
import {
  SetupActions,
  SetupButton,
  SetupCaption,
  SetupPageContent,
  SetupTitle,
} from "@open-erp/ui/components/setup-workspace";
import { SetupTable } from "@open-erp/ui/components/setup-table";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { AccountingStatus } from "@/components/accounting-status";
import {
  bookKey,
  bookPath,
  isUncertainWriteError,
  mutationOptions,
  readAccounting,
} from "@/lib/accounting-api";
import { useBookWorkspace } from "@/lib/book-context";
import { Breadcrumb, PendingRead, SetupLink, type OpenOnboardingView } from "./shared";
import { styles } from "./styles";

export const sourceLabels = {
  company: "Företag",
  previous_books: "Tidigare bokföring",
  bank: "Bank",
  sales: "Kundfakturor",
  purchases: "Leverantörsfakturor",
  tax: "Skattekonto",
  assets: "Anläggningstillgångar",
  payroll: "Löner",
  other: "Dokument",
};
const categories: Array<typeof Onboarding.SourceCategory.Type> = [
  "previous_books",
  "bank",
  "sales",
  "purchases",
  "other",
  "tax",
  "assets",
  "payroll",
];

export function useSieSource(workspace: typeof Onboarding.OnboardingWorkspace.Type) {
  const { book } = useBookWorkspace();
  const source = workspace.sources.find((item) => item.category === "previous_books");
  const inventory = useQuery({
    queryKey: [...bookKey(book), "sie-inventory", source?.occurrence.id],
    enabled: !!source,
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/source-occurrences/${encodeURIComponent(source?.occurrence.id ?? "")}/sie-previews`,
        Sie.SiePreviewInventory,
        { signal },
      ),
    retry: false,
  });
  const latest = inventory.data?.items.toSorted((a, b) => b.ordinal - a.ordinal)[0];
  const preview = useQuery({
    queryKey: [...bookKey(book), "sie-preview", latest?.id],
    enabled: !!latest,
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/sie-previews/${encodeURIComponent(latest?.id ?? "")}`,
        Sie.SiePreview,
        { signal },
      ),
    retry: false,
  });
  const plan = useQuery({
    queryKey: [...bookKey(book), "sie-plan", latest?.planId],
    enabled: !!latest?.planId,
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/sie-plans/${encodeURIComponent(latest?.planId ?? "")}`,
        Sie.SiePlan,
        { signal },
      ),
    retry: false,
  });
  return { source, inventory, latest, preview, plan };
}

export function OnboardingSources({
  workspace,
  open,
}: {
  workspace: typeof Onboarding.OnboardingWorkspace.Type;
  open: OpenOnboardingView;
}) {
  const { book } = useBookWorkspace();
  const [selected, setSelected] = useState<typeof Onboarding.SourceCategory.Type>("other");
  const [uploading, setUploading] = useState<typeof Onboarding.SourceCategory.Type | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const sources = workspace.sources.filter((item) => item.category === selected);
  const occurrence = sources[0]?.occurrence;
  const sourceContent = useQuery({
    queryKey: [...bookKey(book), "source", occurrence?.id],
    enabled: inspecting && !!occurrence,
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/source-occurrences/${encodeURIComponent(occurrence?.id ?? "")}`,
        Intake.SourceOccurrenceView,
        { signal },
      ),
    retry: false,
  });
  return (
    <SetupPageContent styleX={[styles.page, styles.workspace]}>
      <Breadcrumb
        items={[{ label: "Setup", view: "workspace" }, { label: "Källor" }]}
        open={open}
      />
      <div {...stylex.props(styles.earlyTitle)}>
        <SetupTitle>Källor</SetupTitle>
      </div>
      <p {...stylex.props(styles.subtitle)}>
        Det här är underlaget OpenERP har fått. Inget är ännu en bokföring.
      </p>
      <div {...stylex.props(styles.columns, styles.section)}>
        <SetupTable
          title="Källor"
          width={tokens.setupSourcesWidth}
          density="source"
          columns={[
            { id: "category", label: "Källa", width: tokens.setupColumn140 },
            { id: "scope", label: "Omfattning", width: tokens.setupColumn230 },
            { id: "received", label: "Mottaget", width: tokens.setupColumn80 },
            { id: "state", label: "Status", width: tokens.setupColumn150 },
          ]}
          rows={categories.map((category) => {
            const received = workspace.sources.filter((item) => item.category === category);
            return {
              id: category,
              tone: selected === category ? "selected" : undefined,
              cells: [
                <button
                  key="category"
                  type="button"
                  onClick={() => setSelected(category)}
                  {...stylex.props(styles.crumbButton)}
                >
                  {sourceLabels[category]}
                </button>,
                received.length ? (
                  received.map((item) => item.occurrence.filename).join(", ")
                ) : (
                  <SetupLink key="upload" onClick={() => setUploading(category)}>
                    Ladda upp {category === "tax" ? "kontoutdrag" : "underlag"}
                  </SetupLink>
                ),
                received.length ? "Ja" : "Nej",
                <span
                  key="status"
                  {...stylex.props(received.length ? styles.success : styles.warning)}
                >
                  {received.length ? "✓ Mottagen" : "! Ej levererat"}
                </span>,
              ],
            };
          })}
        />
        <aside {...stylex.props(styles.detail)}>
          <h2 {...stylex.props(styles.semibold)}>{sourceLabels[selected]}</h2>
          {sources.length ? (
            <>
              <p>{sources.map((item) => item.occurrence.filename).join(", ")}</p>
              <p {...stylex.props(styles.secondary)}>
                Du kan acceptera begränsningen senare, med namn och datum.
              </p>
            </>
          ) : (
            <p {...stylex.props(styles.secondary)}>Underlag har inte levererats.</p>
          )}
          <SetupActions>
            <SetupButton variant="outline" onClick={() => setUploading(selected)}>
              Ladda upp {selected === "other" ? "original" : "underlag"}
            </SetupButton>
            <SetupButton
              variant="outline"
              disabled={!occurrence}
              onClick={() => setInspecting(true)}
            >
              Visa dem
            </SetupButton>
          </SetupActions>
        </aside>
      </div>
      <div {...stylex.props(styles.section20)}>
        <SetupCaption>Ursprungsfilen ändras aldrig. Rättelser sparas som beslut.</SetupCaption>
      </div>
      {uploading ? (
        <UploadSource category={uploading} workspace={workspace} close={() => setUploading(null)} />
      ) : null}
      {inspecting ? (
        <FormDialog
          title={occurrence?.filename ?? sourceLabels[selected]}
          closeLabel="Stäng"
          size="compact"
          onClose={() => setInspecting(false)}
          onEscape={() => setInspecting(false)}
        >
          <PendingRead
            pending={sourceContent.isPending}
            error={sourceContent.error}
            retry={() => {
              void sourceContent.refetch();
            }}
          />
          {sourceContent.data ? <SourceDownload source={sourceContent.data} /> : null}
        </FormDialog>
      ) : null}
    </SetupPageContent>
  );
}

function SourceDownload({ source }: { source: typeof Intake.SourceOccurrenceView.Type }) {
  return (
    <SetupButton
      onClick={() => {
        const bytes = Uint8Array.from(atob(source.contentBase64), (character) =>
          character.charCodeAt(0),
        );
        const uri = URL.createObjectURL(new Blob([bytes], { type: source.occurrence.mediaType }));
        const anchor = document.createElement("a");
        anchor.href = uri;
        anchor.download = source.occurrence.filename;
        anchor.click();
        URL.revokeObjectURL(uri);
      }}
    >
      Ladda ner
    </SetupButton>
  );
}

function UploadSource({
  category,
  workspace,
  close,
}: {
  category: typeof Onboarding.SourceCategory.Type;
  workspace: typeof Onboarding.OnboardingWorkspace.Type;
  close: () => void;
}) {
  const { book, locale } = useBookWorkspace();
  const [sourceSystem, setSourceSystem] = useState(
    workspace.case.configuration.incumbentSystem ?? "",
  );
  const [account, setAccount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const cache = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const save = useMutation({
    mutationFn: async (input: typeof Intake.RetainSource.Type) => {
      const sourcePath = `${bookPath(book)}/source-occurrences`;
      const source = await readAccounting(
        sourcePath,
        Intake.SourceOccurrence,
        mutationOptions(sourcePath, JSON.stringify(input), keys.current),
      );
      const linkPath = `${bookPath(book)}/onboarding/sources`;
      return readAccounting(
        linkPath,
        Onboarding.OnboardingSource,
        mutationOptions(
          linkPath,
          JSON.stringify({ occurrenceId: source.id, category }),
          keys.current,
        ),
      );
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: bookKey(book) });
      close();
    },
  });
  const uncertain = isUncertainWriteError(save.error);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  async function submit() {
    if (save.isPending || reading || book.role !== "operator") return;
    if (uncertain && save.variables) {
      save.mutate(save.variables);
      return;
    }
    if (!file) return;
    setReading(true);
    setReadError(null);
    try {
      if (file.size > Intake.maxSourceBytes) throw new Error("Filen är större än 5 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let content = "";
      for (const byte of bytes) content += String.fromCharCode(byte);
      save.mutate(
        Schema.decodeUnknownSync(Intake.RetainSource)({
          sourceSystem,
          sourceAccountId: account,
          occurrenceKey: crypto.randomUUID(),
          sourceRevision: "1",
          filename: file.name,
          contentBase64: btoa(content),
          ...(Schema.decodeUnknownOption(Intake.SourceMediaType)(file.type)._tag === "Some"
            ? { mediaType: file.type }
            : {}),
        }),
      );
    } catch (error) {
      setReadError(error instanceof Error ? error.message : "Filen kunde inte läsas.");
    } finally {
      setReading(false);
    }
  }
  return (
    <FormDialog
      title={`Ladda upp ${sourceLabels[category].toLowerCase()}`}
      size="compact"
      closeLabel="Avbryt"
      onClose={close}
      onEscape={() => {
        if (!save.isPending && !reading && !uncertain) close();
      }}
    >
      <form
        {...stylex.props(styles.stack12)}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <InputField
          compact
          label="Tidigare system eller källa"
          required
          value={sourceSystem}
          disabled={save.isPending || reading || uncertain}
          onChange={(event) => setSourceSystem(event.currentTarget.value)}
        />
        <InputField
          compact
          label="Konto eller källans namn"
          required
          value={account}
          disabled={save.isPending || reading || uncertain}
          onChange={(event) => setAccount(event.currentTarget.value)}
        />
        <InputField
          compact
          label="Fil"
          type="file"
          required={!uncertain}
          disabled={save.isPending || reading || uncertain}
          onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
        />
        <SetupActions>
          <SetupButton
            type="submit"
            disabled={book.role !== "operator" || save.isPending || reading}
          >
            Ladda upp
          </SetupButton>
          <SetupButton
            type="button"
            variant="outline"
            disabled={save.isPending || reading || uncertain}
            onClick={close}
          >
            Avbryt
          </SetupButton>
        </SetupActions>
        {readError ? <p role="alert">{readError}</p> : null}
        <AccountingStatus
          locale={locale}
          pending={save.isPending || reading}
          error={save.error}
          write
        />
      </form>
    </FormDialog>
  );
}
