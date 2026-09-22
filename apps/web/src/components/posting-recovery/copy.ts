import type { Locale } from "@/paraglide/runtime";

const english = {
  title: "Recover posting work",
  help: "Find retained proposals after a reload or timeout. This reads PostgreSQL history; it does not retry a command.",
  refresh: "Check current state",
  older: "Older proposals",
  newest: "Newest proposals",
  open: "Review proposal",
  empty:
    "No retained proposals were found on this page. This does not prove that a request still in transit failed.",
  unknown: "Current state is unknown. Check the server again before sending another command.",
  checked: "Checked at",
  sequence: "Ledger sequence",
  posted: "Posted — committed receipt found",
  posted_by_other_proposal: "This event was posted by another proposal",
  unposted_at_check: "Not posted at this check — a pending request may still arrive",
  createdBy: "Prepared by",
  receipt: "Committed execution receipt",
  voucher: "Voucher",
  digest: "Plan digest",
  requestTitle: "Recover an original request",
  requestKey: "Original idempotency key",
  recover: "Look up request",
  committed:
    "A committed command receipt was found. This is historical; review the current proposal before acting.",
  notObserved:
    "No committed receipt was found for this key. The outcome is not confirmed; do not replace the key just because of a timeout.",
  invalidKey: "Enter the original request key (8–128 letters, digits, underscores or hyphens).",
  review: "Review retained proposal",
  reviewCheck: "I reviewed this exact proposal and its supporting evidence.",
  approve: "Approve this exact proposal",
  execute: "Post the approved proposal",
  operatorOnly:
    "Only an operator can create approval. An agent can use a current operator approval.",
  approval: "Available operator approval",
  expires: "Expires",
  blocked: "This proposal cannot be executed with its current dependencies.",
  approvalHelp:
    "Approval is checked again during posting. An expired or consumed approval is not renewed by retrying its old key.",
  pending: "Waiting for the command result…",
  commandUnknown:
    "The command result is not confirmed here. Check current state. A retry keeps the original request identity.",
  storage:
    "This browser could not retain the request key. No posting command was sent. Allow site storage before continuing.",
  history: "Committed request history",
  historyHelp:
    "These immutable receipts describe successful committed commands, not failed or in-flight attempts. Approval status is a current diagnostic.",
  olderRequests: "Older requests",
  newestRequests: "Newest requests",
  operation: "Operation",
  actor: "Actor",
  recorded: "Recorded",
  approvalState: "Approval state",
  result: "Result ID",
  consumed: "Consumed",
  expired: "Expired",
  authority_lost: "Operator authority lost",
  unconsumed_at_check: "Unconsumed at this check",
};
const swedish: typeof english = {
  title: "Återuppta bokföringsarbete",
  help: "Hitta sparade förslag efter omladdning eller timeout. Detta läser PostgreSQL-historiken och skickar inte om något kommando.",
  refresh: "Kontrollera aktuellt läge",
  older: "Äldre förslag",
  newest: "Nyaste förslag",
  open: "Granska förslag",
  empty:
    "Inga sparade förslag hittades på denna sida. Det bevisar inte att en begäran som fortfarande skickas har misslyckats.",
  unknown: "Aktuellt läge är okänt. Kontrollera servern igen innan du skickar ett nytt kommando.",
  checked: "Kontrollerat",
  sequence: "Huvudbokssekvens",
  posted: "Bokfört — sparad kvittens finns",
  posted_by_other_proposal: "Händelsen bokfördes genom ett annat förslag",
  unposted_at_check: "Inte bokfört vid kontrollen — en väntande begäran kan fortfarande komma fram",
  createdBy: "Förberett av",
  receipt: "Sparad bokföringskvittens",
  voucher: "Verifikation",
  digest: "Förslagets hash",
  requestTitle: "Återfinn en ursprunglig begäran",
  requestKey: "Ursprunglig idempotensnyckel",
  recover: "Sök begäran",
  committed:
    "En sparad kommandokvittens hittades. Den visar historik; granska aktuellt förslag innan du går vidare.",
  notObserved:
    "Ingen sparad kvittens hittades för nyckeln. Utfallet är inte bekräftat; byt inte nyckel enbart på grund av timeout.",
  invalidKey:
    "Ange den ursprungliga nyckeln (8–128 bokstäver, siffror, understreck eller bindestreck).",
  review: "Granska sparat förslag",
  reviewCheck: "Jag har granskat detta exakta förslag och dess underlag.",
  approve: "Godkänn detta exakta förslag",
  execute: "Bokför det godkända förslaget",
  operatorOnly:
    "Endast en operatör kan godkänna. En agent kan använda ett aktuellt operatörsgodkännande.",
  approval: "Tillgängligt operatörsgodkännande",
  expires: "Gäller till",
  blocked: "Förslaget kan inte bokföras med sina aktuella beroenden.",
  approvalHelp:
    "Godkännandet kontrolleras igen vid bokföring. Ett utgånget eller förbrukat godkännande förnyas inte genom att återanvända dess gamla nyckel.",
  pending: "Väntar på kommandoresultatet…",
  commandUnknown:
    "Kommandoresultatet är inte bekräftat här. Kontrollera aktuellt läge. Ett nytt försök behåller den ursprungliga begärans identitet.",
  storage:
    "Webbläsaren kunde inte spara begärans nyckel. Inget bokföringskommando skickades. Tillåt lagring för webbplatsen innan du fortsätter.",
  history: "Historik för sparade kommandon",
  historyHelp:
    "Dessa oföränderliga kvittenser visar genomförda kommandon, inte misslyckade eller pågående försök. Godkännandestatus är en aktuell kontroll.",
  olderRequests: "Äldre begäranden",
  newestRequests: "Nyaste begäranden",
  operation: "Åtgärd",
  actor: "Aktör",
  recorded: "Sparad",
  approvalState: "Godkännandestatus",
  result: "Resultat-ID",
  consumed: "Förbrukat",
  expired: "Utgånget",
  authority_lost: "Operatörsbehörighet saknas",
  unconsumed_at_check: "Oförbrukat vid kontrollen",
};
export function postingCopy(locale: Locale) {
  return locale === "sv" ? swedish : english;
}
