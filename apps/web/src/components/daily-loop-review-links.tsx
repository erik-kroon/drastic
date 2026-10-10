import { defaultStringifySearch } from "@tanstack/react-router";
import {
  FormColumn,
  ActionRow,
  FormLink as PageAction,
  FormNote as PageCaption,
} from "@open-erp/ui/kanon/form";
import { workspacePath } from "@/lib/book-context";
import {
  encodeOwnerReturn,
  encodeWorkReturn,
  useWorkReturn,
  type OwnerReturn,
} from "@/lib/work-return";
import type { CommerceProps } from "./commerce/shared";

export function DailyLoopReviewLinks(
  props: CommerceProps & { owner: OwnerReturn; periodId?: string },
) {
  const work = useWorkReturn();
  const sv = props.locale === "sv";
  const base = workspacePath(props.book);
  const context = { work: encodeWorkReturn(work), returnTo: encodeOwnerReturn(props.owner) };

  return (
    <FormColumn>
      <PageCaption>
        {sv
          ? "Betalningsmatchning, bankavstämning, moms och periodlås granskas var för sig. En sparad matchning bevisar inte att perioden är komplett."
          : "Payment matching, bank reconciliation, VAT and period locking are reviewed separately. A saved match does not prove period completeness."}
      </PageCaption>
      <ActionRow>
        <PageAction href={`${base}/accounts${defaultStringifySearch(context)}`}>
          {sv ? "Granska bankavstämning" : "Review bank reconciliation"}
        </PageAction>
        <PageAction
          href={`${base}/tax${defaultStringifySearch({ ...context, view: "actual-vat" })}`}
        >
          {sv ? "Granska periodens moms" : "Review period VAT"}
        </PageAction>
        <PageAction
          href={`${base}/closing${defaultStringifySearch({ ...context, record: props.periodId ?? work?.period })}`}
        >
          {sv ? "Granska periodkontroller" : "Review period controls"}
        </PageAction>
      </ActionRow>
    </FormColumn>
  );
}
