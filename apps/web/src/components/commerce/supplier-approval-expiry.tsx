import { Api } from "@open-erp/contracts/api";
import { bookScope, httpRequest } from "@/lib/contract-client";
import type { ReactNode } from "react";
import * as Acceptance from "@open-erp/contracts/supplier-acceptance";
import { SupplierApprovalExpiryPane } from "@open-erp/ui/components/supplier-approval-expiry";
import { formatMinorAmount } from "@/lib/workspace-api";
import { CommandForm, commercePath, type CommerceProps } from "./shared";

type View = typeof Acceptance.SupplierAcceptanceView.Type;

export function isSupplierApprovalExpired(view: View) {
  return (
    view.approvalObservation.state === "expired" &&
    view.approvalObservation.proposalMatches &&
    view.dependenciesCurrent &&
    view.acceptance === null &&
    view.approval !== null
  );
}

export function supplierApprovalRefetchInterval(view: View | undefined) {
  if (view?.approvalObservation.state !== "available" || !view.approval) return false;

  return Math.max(
    1000,
    Date.parse(view.approval.expiresAt) - Date.parse(view.approvalObservation.observedAt) + 20,
  );
}

function approvalDate(value: string, locale: CommerceProps["locale"], includeDate: boolean) {
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Stockholm",
  };

  if (includeDate) {
    options.day = "numeric";
    options.month = "short";
  }

  return new Intl.DateTimeFormat(locale === "sv" ? "sv-SE" : "en-GB", options)
    .format(new Date(value))
    .replace(/\.(?=\s)/g, "");
}

export function SupplierApprovalExpiry(
  props: CommerceProps & {
    view: View;
    ready: boolean;
    onRenewed: () => void;
    heading?: boolean;
    children?: ReactNode;
  },
) {
  const { view, locale } = props;
  const observation = view.approvalObservation;
  const approval = view.approval;

  if (observation.state !== "expired" || !approval || !isSupplierApprovalExpired(view)) return null;

  const sv = locale === "sv";
  const actor = observation.actorName ?? approval.actorId;
  const expires = approvalDate(approval.expiresAt, locale, true);
  const created = approvalDate(approval.createdAt, locale, true);
  const createdTime = approvalDate(approval.createdAt, locale, false);
  const expiresTime = approvalDate(approval.expiresAt, locale, false);
  const draft = view.plan.draftSnapshot;

  return (
    <SupplierApprovalExpiryPane
      heading={
        props.heading
          ? {
              caption: sv ? "Leverantörsfaktura, förslag" : "Supplier invoice, proposal",
              title: draft.counterparty.displayName,
              amount:
                draft.totals.grossMinor === null
                  ? "—"
                  : formatMinorAmount(draft.totals.grossMinor, draft.content.currencyScale, locale),
            }
          : undefined
      }
      approvalLabel={sv ? "Godkännandet" : "Approval"}
      notice={
        sv
          ? `Godkännandet gäller i en timme och gick ut ${expires}. Det gjordes ${createdTime} av ${actor}. Ingenting bokfördes.`
          : `The approval is valid for one hour and expired ${expires}. It was given at ${createdTime} by ${actor}. Nothing was posted.`
      }
      proposalLabel={`${sv ? "Förslag, version" : "Proposal, version"} ${view.plan.ordinal}`}
      unchangedLabel={sv ? "Oförändrat" : "Unchanged"}
      actorLabel={`${sv ? "Godkänt av" : "Approved by"} ${actor}`}
      approvedAt={created}
      expiryLabel={sv ? "Godkännandet gällde till" : "Approval was valid until"}
      expiredAt={`${expiresTime}, ${sv ? "utgånget" : "expired"}`}
      explanation={
        sv
          ? "Förslaget är oförändrat sedan godkännandet, men ett godkännande kan inte användas efter en timme. Godkänn samma version igen. Om något ändras måste en ny version granskas."
          : "The proposal is unchanged since approval, but an approval cannot be used after one hour. Approve the same version again. If anything changes, a new version must be reviewed."
      }
      postLabel={sv ? "Bokför" : "Post"}
      renewal={
        <CommandForm
          book={props.book}
          locale={locale}
          compact
          path={`${commercePath(props.book)}/supplier-acceptance-reviews/${encodeURIComponent(view.plan.id)}/approvals`}
          recoveryId={view.plan.id}
          schema={Acceptance.ApproveSupplierAcceptance}
          output={Acceptance.SupplierAcceptanceApproval}
          label={sv ? "Godkänn igen" : "Approve again"}
          fullWidthSubmit
          allowed={props.ready && props.book.role === "operator"}
          input={() => ({ version: 1, digest: view.plan.digest, acknowledgeSyntheticOnly: true })}
          onSuccess={props.onRenewed}
          operation={(client, requestOptions) =>
            client.supplierAcceptance.approveSupplierAcceptance(
              httpRequest(
                Api.groups.supplierAcceptance.endpoints.approveSupplierAcceptance,
                { params: { ...bookScope(props.book), id: view.plan.id } },
                requestOptions,
              ),
            )
          }
        />
      }
    >
      {props.children}
    </SupplierApprovalExpiryPane>
  );
}
