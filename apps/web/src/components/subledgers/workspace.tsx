import { Tabs, TabsList, TabsTrigger, TabsContent } from "@open-erp/ui/components/tabs";
import { useBookWorkspace, reviewPath } from "@/lib/book-context";
import { useNavigate } from "@tanstack/react-router";
import { SubledgersPanel } from "./schedules";
import { SubledgerControlsPanel } from "@/components/subledger-controls/panel";

export function AssetWorkspace(props: { recordId?: string; onOpen: (id: string) => void }) {
  const { book, setup, locale } = useBookWorkspace();
  const navigate = useNavigate();

  return (
    <Tabs defaultValue="schedules">
      <TabsList>
        <TabsTrigger value="schedules">{locale === "sv" ? "Planer" : "Schedules"}</TabsTrigger>
        <TabsTrigger value="controls">
          {locale === "sv" ? "Avstämning" : "Reconciliation"}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="schedules" keepMounted>
        <SubledgersPanel
          book={book}
          setup={setup}
          locale={locale}
          open
          recordId={props.recordId}
          onOpen={props.onOpen}
          onPrepared={(id) => void navigate({ to: reviewPath(book, id) })}
        />
      </TabsContent>
      <TabsContent value="controls" keepMounted>
        <SubledgerControlsPanel book={book} setup={setup} locale={locale} />
      </TabsContent>
    </Tabs>
  );
}
