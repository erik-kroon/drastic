import { Upload } from "lucide-react";
import { DeadlineObligations } from "./deadline-obligations";
import { RuleImpactPanel } from "./rule-impact-panel";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import {
  PageContent,
  WorkspaceWelcome,
  TaskColumns,
  PageAction,
} from "@open-erp/ui/components/accounting-page";
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
        <WorkspaceWelcome
          title={work.book.name}
          context={
            sv
              ? "Ditt bolag, arbetet som väntar och vad som behöver följas upp."
              : "Your company, the work ahead and what needs following up."
          }
        />
        <CompanyPosition work={work} />
        <TaskColumns>
          <CompanyAttention work={work} />
          <ResumeInvoices work={work} />
        </TaskColumns>
        <CompanyBankAccounts work={work} />
        <CompanyOpenInvoices work={work} />
        <DeadlineObligations book={work.book} locale={work.locale} />
        <RuleImpactPanel book={work.book} locale={work.locale} />
      </PageContent>
    </>
  );
}
