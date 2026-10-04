import { useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Option from "effect/Option";
import * as Legal from "@open-erp/contracts/legal-sales-policy";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Catalog from "@open-erp/contracts/catalog";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { PageCaption, PageEmpty, RecordOpen } from "@open-erp/ui/components/accounting-page";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { RegisterWorkspace } from "@open-erp/ui/components/register-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { mutationOptions, readAccounting } from "@/lib/accounting-api";
import {
  decimalToMinor,
  formatMinorAmount,
  minorToDecimal,
  workQueryOptions,
} from "@/lib/workspace-api";
import { commerceKey, commercePath, type CommerceProps } from "./shared";

type Article = typeof Catalog.Article.Type;

type ArticleForm = {
  code: string;
  expectedRevision: number;
  description: string;
  unit: string;
  unitPrice: string;
  taxDescription: string;
  treatment: typeof Catalog.ArticleTreatment.Type;
  status: typeof Catalog.ArticleStatus.Type;
};

function emptyForm(): ArticleForm {
  return {
    code: "",
    expectedRevision: 0,
    description: "",
    unit: "",
    unitPrice: "",
    taxDescription: "",
    treatment: { kind: "unresolved" },
    status: "active",
  };
}

function articleForm(article: Article, scale: number): ArticleForm {
  return {
    code: article.code,
    expectedRevision: article.revision,
    description: article.description,
    unit: article.unit,
    unitPrice: article.unitPriceMinor ? minorToDecimal(article.unitPriceMinor, scale) : "",
    taxDescription: article.taxDescription ?? "",
    treatment: article.treatment ?? { kind: "unresolved" },
    status: article.status ?? "active",
  };
}

function minor(value: string, scale: number) {
  const normalized = value.trim();

  if (!normalized) return null;

  if (!/^\d+(?:[.,]\d+)?$/.test(normalized)) return "invalid";

  return decimalToMinor(normalized, scale) ?? "invalid";
}

export function CatalogArticles(props: CommerceProps & { navigation: ReactNode }) {
  const { book, locale } = props;
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const newArticleButton = useRef<HTMLButtonElement>(null);
  const openerCode = useRef<string | null>(null);
  const [form, setForm] = useState<ArticleForm>(emptyForm);
  const [keys] = useState(() => new Map<string, string>());
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const metadata = useQuery(workQueryOptions(book, {}));

  const policies = useQuery({
    queryKey: [...commerceKey(book), "commercial-policies"],
    queryFn: ({ signal }) =>
      readAccounting(`${commercePath(book)}/legal-sales-policies`, Legal.LegalSalesPolicyHistory, {
        signal,
      }),
    retry: false,
  });

  const articles = useInfiniteQuery({
    queryKey: [...commerceKey(book), "catalog-articles", "all"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) =>
      readAccounting(
        `${commercePath(book)}/articles?status=all${pageParam ? `&after=${encodeURIComponent(pageParam)}` : ""}`,
        Catalog.ArticlePage,
        { signal },
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });

  const save = useMutation({
    mutationFn: (input: typeof Catalog.SaveArticle.Type) => {
      const body = JSON.stringify(input);

      return readAccounting(
        `${commercePath(book)}/articles`,
        Catalog.Article,
        mutationOptions(`${commercePath(book)}/articles`, body, keys),
      );
    },
    onSuccess: (article) => {
      if (metadata.data) setForm(articleForm(article, metadata.data.currencyScale));
      setSaved(true);
      setInvalid(false);
      void client.invalidateQueries({ queryKey: [...commerceKey(book), "catalog-articles"] });
    },
    onError: (error) => {
      setSaved(false);

      if (error instanceof Accounting.AccountingError && error.code === "StaleDependency")
        void client.invalidateQueries({ queryKey: [...commerceKey(book), "catalog-articles"] });
    },
    retry: false,
  });

  const items = articles.data?.pages.flatMap((page) => page.items) ?? [];
  const scale = metadata.data?.currencyScale;

  return (
    <RegisterWorkspace
      title={labels.sales}
      tabs={props.navigation}
      action={
        <Button
          type="button"
          size="sm"
          ref={newArticleButton}
          disabled={book.role !== "operator" || save.isPending}
          onClick={() => {
            openerCode.current = null;
            setEditing(true);
            setForm(emptyForm());
            setInvalid(false);
            setSaved(false);
          }}
        >
          {labels.newArticle}
        </Button>
      }
    >
      <AccountingStatus locale={locale} pending={articles.isPending} error={articles.error} />
      {articles.isSuccess ? (
        items.length ? (
          <DataTable
            title={labels.currentRevisions}
            narrow="stack"
            presentation="register"
            columns={[
              { id: "description", label: labels.article, width: "fill" },
              { id: "unit", label: labels.unit, width: 90 },
              { id: "tax", label: labels.vat, width: 80, numeric: true },
              { id: "price", label: labels.price, numeric: true, width: 120 },
              { id: "revenueAccount", label: labels.revenueAccount, numeric: true, width: 110 },
            ]}
            rows={items.map((article) => ({
              id: article.code,
              cells: [
                <RecordOpen
                  key="description"
                  presentation="register"
                  data-article-code={article.code}
                  aria-label={`${article.description}, ${article.code}`}
                  onClick={() => {
                    if (scale !== undefined) {
                      openerCode.current = article.code;
                      setEditing(true);
                      setForm(articleForm(article, scale));
                      setInvalid(false);
                      setSaved(false);
                    }
                  }}
                >
                  {article.description}
                  {article.status === "archived" ? (sv ? ", Arkiverad" : ", Archived") : ""}
                </RecordOpen>,
                article.unit,
                article.taxDescription ?? "—",
                scale === undefined || article.unitPriceMinor === null
                  ? "—"
                  : formatMinorAmount(article.unitPriceMinor, scale, locale),
                "—",
              ],
            }))}
          />
        ) : (
          <PageEmpty title={labels.empty} detail={labels.emptyDetail} />
        )
      ) : null}
      {articles.hasNextPage ? (
        <Box>
          <Button
            type="button"
            variant="outline"
            disabled={articles.isFetchingNextPage}
            onClick={() => void articles.fetchNextPage()}
          >
            {labels.loadMore}
          </Button>
        </Box>
      ) : null}
      {scale === undefined ? (
        <AccountingStatus locale={locale} pending={metadata.isPending} error={metadata.error} />
      ) : editing ? (
        <FormDialog
          size="register"
          title={form.expectedRevision ? labels.updateArticle : labels.newArticle}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={() => setEditing(false)}
          onEscape={() => setEditing(false)}
          finalFocus={() => {
            const button = Array.from(
              document.querySelectorAll<HTMLButtonElement>("button[data-article-code]"),
            ).find((element) => element.dataset.articleCode === openerCode.current);

            return button ?? newArticleButton.current;
          }}
        >
          <Box
            as="form"
            display="grid"
            gap="md"
            onSubmit={(event) => {
              event.preventDefault();

              const parsed = Schema.decodeOption(Catalog.SaveArticle)({
                code: form.code,
                expectedRevision: form.expectedRevision,
                description: form.description,
                unit: form.unit,
                unitPriceMinor: minor(form.unitPrice, scale),
                taxDescription: form.taxDescription.trim() || null,
                treatment: form.treatment,
                status: form.status,
              });

              setInvalid(Option.isNone(parsed));

              if (Option.isSome(parsed)) save.mutate(parsed.value);
            }}
          >
            <Box
              as="fieldset"
              disabled={book.role !== "operator" || save.isPending}
              display="grid"
              gap="md"
              minWidth="zero"
              borderWidth="none"
              margin="none"
              padding="none"
            >
              <Box display="grid" columnsAtSm={2} gap="md">
                <InputField
                  compact
                  label={labels.code}
                  value={form.code}
                  required
                  maxLength={64}
                  pattern={"[A-Za-z0-9][A-Za-z0-9._\\-]*"}
                  disabled={form.expectedRevision > 0}
                  onChange={(event) => {
                    setSaved(false);
                    setForm({ ...form, code: event.target.value });
                  }}
                />
                <InputField
                  compact
                  label={labels.unit}
                  value={form.unit}
                  required
                  maxLength={32}
                  onChange={(event) => {
                    setSaved(false);
                    setForm({ ...form, unit: event.target.value });
                  }}
                />
              </Box>
              <InputField
                compact
                label={labels.description}
                value={form.description}
                required
                maxLength={500}
                onChange={(event) => {
                  setSaved(false);
                  setForm({ ...form, description: event.target.value });
                }}
              />
              <Box display="grid" columnsAtSm={2} gap="lg">
                <InputField
                  compact
                  label={`${labels.unitPrice} (${book.currency})`}
                  value={form.unitPrice}
                  inputMode="decimal"
                  placeholder="—"
                  onChange={(event) => {
                    setSaved(false);
                    setForm({ ...form, unitPrice: event.target.value });
                  }}
                />
                <InputField
                  compact
                  label={`${labels.taxTreatment} (${sv ? "valfritt" : "optional"})`}
                  value={form.taxDescription}
                  maxLength={200}
                  placeholder="—"
                  onChange={(event) => {
                    setSaved(false);
                    setForm({ ...form, taxDescription: event.target.value });
                  }}
                />
              </Box>
              <AccountingStatus
                locale={locale}
                pending={policies.isPending}
                error={policies.error}
              />
              <SelectField
                compact
                label={sv ? "Granskad momsprofil" : "Reviewed tax profile"}
                value={form.treatment.kind === "legal_sales_policy" ? form.treatment.id : ""}
                options={[
                  { value: "", label: sv ? "Ej fastställd" : "Unresolved" },
                  ...(policies.data?.items.map((policy) => ({
                    value: policy.id,
                    label: `${policy.candidate.input.sellerIdentity.legalName}, ${policy.candidate.input.vatTreatment}`,
                  })) ?? []),
                ]}
                onValueChange={(id) => {
                  const policy = policies.data?.items.find((item) => item.id === id);
                  setForm({
                    ...form,
                    treatment: policy
                      ? { kind: "legal_sales_policy", id: policy.id, digest: policy.digest }
                      : { kind: "unresolved" },
                  });
                }}
              />
              <SelectField
                compact
                label={sv ? "Artikelstatus" : "Article status"}
                value={form.status}
                options={[
                  { value: "active", label: sv ? "Aktiv" : "Active" },
                  { value: "archived", label: sv ? "Arkiverad" : "Archived" },
                ]}
                onValueChange={(status) =>
                  setForm({ ...form, status: status === "archived" ? "archived" : "active" })
                }
              />
              <Box>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending
                    ? labels.saving
                    : form.expectedRevision
                      ? labels.saveUpdate
                      : labels.create}
                </Button>
              </Box>
            </Box>
            {invalid ? <Text role="alert">{labels.invalid}</Text> : null}
            <AccountingStatus locale={locale} write pending={save.isPending} error={save.error} />
            {saved ? <Text role="status">{labels.saved}</Text> : null}
            <PageCaption>{labels.revisionNote}</PageCaption>
          </Box>
        </FormDialog>
      ) : null}
    </RegisterWorkspace>
  );
}

const english = {
  sales: "Sales",
  article: "Article",
  revenueAccount: "Revenue account",
  vat: "VAT",
  price: "Price",
  title: "Article catalog",
  subtitle: "Save the current defaults copied into new and edited invoice drafts.",
  newArticle: "New article",
  currentRevisions: "Current article revisions",
  code: "Code",
  description: "Description",
  unit: "Unit",
  unitPrice: "Unit price",
  taxTreatment: "Tax treatment",
  revision: "Revision",
  empty: "No saved articles",
  emptyDetail: "Create the products and services used on invoice drafts.",
  loadMore: "Load more articles",
  createArticle: "Create article",
  updateArticle: "Update article",
  create: "Create article",
  saveUpdate: "Save update",
  saving: "Saving…",
  invalid: "Check the article code, description, unit, price and tax treatment.",
  saved: "Article revision saved.",
  revisionNote:
    "Saving creates the next revision. Earlier revisions remain available to invoice drafts.",
};

const swedish: typeof english = {
  sales: "Försäljning",
  article: "Artikel",
  revenueAccount: "Intäktskonto",
  vat: "Moms",
  price: "Pris",
  title: "Artikelkatalog",
  subtitle: "Spara aktuella standardvärden som kopieras till nya och redigerade fakturautkast.",
  newArticle: "Ny artikel",
  currentRevisions: "Aktuella artikelrevisioner",
  code: "Kod",
  description: "Beskrivning",
  unit: "Enhet",
  unitPrice: "Enhetspris",
  taxTreatment: "Momsbehandling",
  revision: "Revision",
  empty: "Inga sparade artiklar",
  emptyDetail: "Skapa produkter och tjänster som används på fakturautkast.",
  loadMore: "Läs in fler artiklar",
  createArticle: "Skapa artikel",
  updateArticle: "Uppdatera artikel",
  create: "Skapa artikel",
  saveUpdate: "Spara ändring",
  saving: "Sparar…",
  invalid: "Kontrollera artikelkod, beskrivning, enhet, pris och momsbehandling.",
  saved: "Artikelrevisionen har sparats.",
  revisionNote: "Sparning skapar nästa revision. Tidigare revisioner finns kvar för fakturautkast.",
};
