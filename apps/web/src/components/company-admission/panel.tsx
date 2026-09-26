import { useQuery } from "@tanstack/react-query";
import * as Profiles from "@open-erp/contracts/company-profiles";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace } from "@/lib/book-context";
import { english, swedish } from "./copy";

type Profile = typeof Profiles.CompanyProfile.Type;

type Copy = typeof english;

export function CompanyAdmission() {
  const { book, locale } = useBookWorkspace();
  const copy = locale === "sv" ? swedish : english;
  const today = new Date().toISOString().slice(0, 10);

  const profile = useQuery({
    queryKey: [...bookKey(book), "company-profile", today],
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/company-profile?${admissionQuery(today)}`,
        Profiles.CompanyProfile,
        { signal },
      ),
    retry: false,
  });

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Text>{copy.intro}</Text>
      <AccountingStatus locale={locale} pending={profile.isPending} error={profile.error} />
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={profile.isFetching}
          onClick={() => {
            void profile.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      {profile.data ? <Resolution profile={profile.data} copy={copy} /> : null}
    </Box>
  );
}

// The panel asks about today. A real operation supplies its own dates instead.
function admissionQuery(today: string) {
  return new URLSearchParams({
    recordClass: "actual_company",
    postingOn: today,
    taxPointOn: today,
    paymentOn: today,
    reportOn: today,
  }).toString();
}

function Resolution({ profile, copy }: { profile: Profile; copy: Copy }) {
  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <DataTable
        title={copy.title}
        narrow="stack"
        columns={[
          { id: "family", label: copy.family },
          { id: "date", label: copy.selectorDate },
          { id: "status", label: copy.status },
          { id: "gap", label: copy.gap },
          { id: "blocks", label: copy.blocks },
        ]}
        rows={profile.families.map((family) => ({
          id: family.family,
          cells: [
            family.family,
            family.selectorDate ?? copy.noDate,
            family.status === "resolved" ? copy.admitted : copy.incomplete,
            family.gaps.length === 0
              ? copy.none
              : family.gaps.map((gap) => copy[gap.state]).join("; "),
            [...new Set(family.gaps.flatMap((gap) => gap.affectedOperations))].join(", "),
          ],
        }))}
      />
      {profile.ownerBoundFamilies.map((family) => (
        <RecordSection key={family.family} title={copy.ownerBound}>
          <Text tone="muted">{copy.ownerBoundHint}</Text>
          <DataTable
            title={family.family}
            narrow="stack"
            columns={[
              { id: "family", label: copy.family },
              { id: "status", label: copy.status },
              { id: "owner", label: copy.blocks },
            ]}
            rows={[
              {
                id: family.family,
                cells: [
                  family.family,
                  family.admitted ? copy.admitted : copy.incomplete,
                  family.activationOwner,
                ],
              },
            ]}
          />
        </RecordSection>
      ))}
    </Box>
  );
}
