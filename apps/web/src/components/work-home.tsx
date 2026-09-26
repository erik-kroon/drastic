import { BookOpen, Upload, ReceiptText } from "lucide-react";
import {
  PageContent,
  WorkspaceWelcome,
  TaskColumns,
  PageAction,
} from "@open-erp/ui/components/accounting-page";
import { Box } from "@open-erp/ui/components/box";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { useCompanyWork } from "@/lib/company-work";
import { CompanyAttention, ResumeInvoices } from "./company-work-sections";

export function WorkHome() {
  const work = useCompanyWork();
  const sv = work.locale === "sv";

  return (
    <>
      <WorkspaceHeader
        title={sv ? "Att göra" : "To do"}
        action={
          <PageAction href={`${work.base}/purchases?view=documents&record=new`}>
            <Upload size={14} strokeWidth={1.5} />
            {sv ? "Ladda upp underlag" : "Upload document"}
          </PageAction>
        }
      />
      <PageContent>
        <WorkspaceWelcome
          title={sv ? "Vad behöver göras?" : "Your work, in one place"}
          context={work.book.name}
        />
        <Box display="flex" gap="md" flexWrap="wrap">
          <PageAction quiet href={`${work.base}/purchases?view=expenses&record=new`}>
            <ReceiptText size={14} strokeWidth={1.5} />
            {sv ? "Lägg till utgift" : "Add expense"}
          </PageAction>
          <PageAction quiet href={`${work.base}/books?view=journal`}>
            <BookOpen size={14} strokeWidth={1.5} />
            {sv ? "Ny verifikation" : "New entry"}
          </PageAction>
        </Box>
        <TaskColumns>
          <CompanyAttention work={work} />
          <ResumeInvoices work={work} />
        </TaskColumns>
      </PageContent>
    </>
  );
}
