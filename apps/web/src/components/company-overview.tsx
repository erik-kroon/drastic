import { OverviewLayout } from "@open-erp/ui/components/overview-layout";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { Upload } from "lucide-react";
import { DeadlineObligations } from "./deadline-obligations";
import { RuleImpactPanel } from "./rule-impact-panel";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { PageContent, PageAction } from "@open-erp/ui/components/accounting-page";
import { useCompanyWork } from "@/lib/company-work";
import {
  CompanyPosition,
  CompanyAttention,
  ResumeInvoices,
  CompanyBankAccounts,
  CompanyOpenInvoices,
} from "./company-work-sections";

export function CompanyOverview() {
  const work = useCompanyWork();
  const sv = work.locale === "sv";

  return (
    <>
      <WorkspaceHeader
        title={sv ? "Översikt" : "Overview"}
        action={
          <PageAction href={`${work.base}/purchases?view=documents&record=new`}>
            <Upload size={14} strokeWidth={1.5} />
            {sv ? "Ladda upp underlag" : "Upload document"}
          </PageAction>
        }
      />
      <PageContent>
        <OverviewLayout
          context={`${work.book.name}, ${work.from} – ${work.to}`}
          main={
            <>
              <CompanyPosition work={work} />
              <CompanyBankAccounts work={work} />
              <CompanyOpenInvoices work={work} />
            </>
          }
          aside={
            <>
              <CompanyAttention work={work} />
              <ResumeInvoices work={work} />
              <Disclosure title={sv ? "Tidsfrister" : "Deadlines"}>
                <DeadlineObligations book={work.book} locale={work.locale} />
              </Disclosure>
              <Disclosure title={sv ? "Regeländringar" : "Rule changes"}>
                <RuleImpactPanel book={work.book} locale={work.locale} />
              </Disclosure>
            </>
          }
        />
      </PageContent>
    </>
  );
}
