import type { Locale } from "@/paraglide/runtime";

const english = {
  revoked: "Revoked",
  savedTitle: "Resume saved work",
  savedHelp:
    "These requests survive reload. Saving does not run a command. Only a committed execution receipt proves posting. Pages are live, not a complete source inventory.",
  savedEmpty: "No saved requests on this page. A delayed save may still arrive.",
  inspect: "Inspect saved request",
  savedCommand: "Exact saved command",
  commandDigest: "Saved request digest",
  commandKey: "Kernel command key",
  savedUnknown:
    "No terminal outcome observed. This request may be unattempted or still in flight. Keep its identity.",
  savedCommitted: "This command committed. Preparation and approval do not mean posting.",
  savedRefused:
    "This request was refused. Its attempted changes were rolled back. This does not say that another request did not post the event.",
  replayCheck: "I reviewed the exact saved command. Run it unchanged under my current authority.",
  run: "Run this saved request",
  newRequest: "Save as a new request and run",
  terminalHelp:
    "A refused request stays refused. After resolving its blocker, you can deliberately create a new request. An unknown request must keep its original identity.",
  otherActor:
    "Only the actor who saved this request can run it. Current book access still permits reading its history.",
  resumeEvidence: "Use this retained evidence",
  revoke: "Revoke this approval",
  revokeReason: "Reason for revocation",
  revokeHelp:
    "Revocation prevents later consumption. It does not undo a committed posting. Any current operator in this book can revoke an unused approval.",
  anotherEvidence: "Use a different source",
  saveEvidence: "Save source & continue",
  savePrepare: "Review entry",
  saveApprove: "Approve proposal",
  saveExecute: "Post entry",
  outcome: "Saved command outcome",

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
  posted: "Posted",
  posted_by_other_proposal: "This event was posted by another proposal",
  unposted_at_check: "Not posted at last check",
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
  revoked: "Återkallat",
  savedTitle: "Återuppta sparat arbete",
  savedHelp:
    "Begärandena finns kvar efter omladdning. Att spara kör inget kommando. Endast en sparad bokföringskvittens bevisar bokföring. Sidorna är aktuella läsningar, inte en fullständig underlagsförteckning.",
  savedEmpty:
    "Inga sparade begäranden på denna sida. En fördröjd begäran kan fortfarande komma fram.",
  inspect: "Granska sparad begäran",
  savedCommand: "Exakt sparat kommando",
  commandDigest: "Sparad begärans hash",
  commandKey: "Kärnkommandots nyckel",
  savedUnknown:
    "Inget slutligt utfall har observerats. Begäran kan vara oprövad eller fortfarande på väg. Behåll dess identitet.",
  savedCommitted: "Kommandot genomfördes. Förberedelse och godkännande innebär inte bokföring.",
  savedRefused:
    "Begäran avvisades. Dess försök till ändringar rullades tillbaka. Det säger inte att en annan begäran inte bokförde händelsen.",
  replayCheck:
    "Jag har granskat det exakta sparade kommandot. Kör det oförändrat med min nuvarande behörighet.",
  run: "Kör denna sparade begäran",
  newRequest: "Spara som ny begäran och kör",
  terminalHelp:
    "En avvisad begäran förblir avvisad. När hindret är löst kan du uttryckligen skapa en ny begäran. En begäran med okänt utfall måste behålla sin ursprungliga identitet.",
  otherActor:
    "Endast aktören som sparade begäran kan köra den. Aktuell åtkomst till boken medger fortfarande läsning av historiken.",
  resumeEvidence: "Använd detta sparade underlag",
  revoke: "Återkalla detta godkännande",
  revokeReason: "Skäl för återkallelse",
  revokeHelp:
    "Återkallelse förhindrar senare förbrukning. Den gör inte genomförd bokföring ogjord. En aktuell operatör i denna bok kan återkalla ett oförbrukat godkännande.",
  anotherEvidence: "Använd ett annat underlag",
  saveEvidence: "Spara underlag och fortsätt",
  savePrepare: "Granska kontering",
  saveApprove: "Godkänn förslag",
  saveExecute: "Bokför posten",
  outcome: "Sparat kommandoutfall",

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
  posted: "Bokfört",
  posted_by_other_proposal: "Händelsen bokfördes genom ett annat förslag",
  unposted_at_check: "Inte bokfört vid senaste kontrollen",
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
