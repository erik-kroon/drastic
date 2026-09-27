import type * as PeriodWork from "@open-erp/contracts/period-work";
import type { Locale } from "@/paraglide/runtime";

type ChildState = typeof PeriodWork.PeriodWorkChildProgress.Type.state;

const english = {
  title: "Period work",
  help: "A frozen selection of work, and what each child has actually reached. Advancing visits a bounded number of children through the owner that holds each effect. It never posts by itself and never says the period is reconciled.",
  manifest: "Manifest",
  manifestHelp:
    "This page reads one prepared selection. It does not create one: a selection is frozen from a consistent capture and sealed with its rules.",
  open: "Open selection",
  openHelp: "Open the selection by its identifier. Reload and a shared link find the same run.",
  refresh: "Check current state",
  advance: "Advance the next children",
  advanceCount: "Children this pass",
  advanceHelp:
    "Each visited child is claimed, handed to its owner and checkpointed. A child missing facts or an owning review is recorded as needing review instead.",
  cancel: "Cancel this run",
  cancelHelp:
    "Cancelling keeps every prepared plan as retained evidence. A handler that is already working stops publishing its result.",
  notReconciled:
    "This run is not a reconciled period. Visited children are not a completeness claim; the source and control inventory decides that.",
  populationComplete: "The captured source population was complete.",
  populationIncomplete: "The captured source population was not complete.",
  counts: "Child states",
  work: "Work",
  stateColumn: "State",
  owner: "Routed owner",
  plan: "Prepared plan",
  batch: "Approval batch",
  missing: "Missing facts",
  refused: "Refused because",
  visited: "Visited",
  selected: "Selected",
  pending: "Not started",
  waitingPredecessor: "Waiting on an earlier child",
  needsReview: "Needs review",
  prepared: "Prepared",
  recovered: "Recovered",
  committed: "Committed",
  refusedState: "Refused",
  none: "None recorded",
  identityMismatch: "The response did not belong to this book and this run.",
  empty: "This selection has no children.",

  batchTitle: "Approval batch",
  batchHelp:
    "A batch is a fixed list of already sealed plans that one human gesture covers. It is not a rule that admits a later arrival: a child added after the batch was sealed is not in it, and a child whose plan moved since is refused rather than approved on a different set.",
  batchSelect: "Select prepared work",
  batchSelectHelp:
    "Only a prepared child with a sealed plan and its owning review can be a member. A child waiting on an earlier child cannot be until that child commits.",
  batchNotWaiting: "Waiting on an earlier child",
  batchNotPrepared: "No sealed plan yet",
  batchNoOwner: "No owning review yet",
  batchSelected: "selected",
  batchMaximum: (n: number) => `at most ${n} per batch`,
  batchSeal: "Seal this batch",
  batchSealed: "Sealed batch",
  batchCombined: "Combined effect, informational",
  batchCombinedNote:
    "The combined figure is shown for the reviewer. It is never a journal line and never a balancing figure.",
  batchDigest: "Sealed digest",
  batchMembers: "Members",
  review: "Owning review",
  receipt: "Receipt",
  batchApprove: "Approve this batch",
  batchApproved:
    "This batch is approved. Its members can now be executed through their own owners.",
  batchAlreadyApproved: "This batch was already approved.",
  batchExecute: "Execute the next members",
  batchExecuted: "What this pass did",
  batchCommitted: "Committed",
  batchRefused: "Refused",
  batchNextPage: "Continue from the next member",
  batchNoMembers: "No prepared work to select.",
  batchOperatorOnly:
    "Only an operator can approve or execute a batch. This is the sealed batch as an operator would see it.",
  batchAcknowledge:
    "I understand this approves and posts this exact set of synthetic-only effects, and that a member whose owner refuses is left for review rather than retried.",
};

const swedish: typeof english = {
  title: "Periodarbete",
  help: "Ett fruset urval arbete och vad varje post faktiskt har nått. Att gå vidare besöker ett begränsat antal poster genom den ägare som håller varje effekt. Steget bokför aldrig själv och påstår aldrig att perioden är avstämd.",
  manifest: "Manifest",
  manifestHelp:
    "Sidan läser ett förberett urval. Den skapar inget: ett urval fryses från en enhetlig avläsning och förseglas med sina regler.",
  open: "Öppna urval",
  openHelp:
    "Öppna urvalet med dess identifierare. En omladdning och en delad länk hittar samma körning.",
  refresh: "Kontrollera aktuellt läge",
  advance: "Gå vidare med nästa poster",
  advanceCount: "Poster den här omgången",
  advanceHelp:
    "Varje besökt post reserveras, lämnas till sin ägare och registreras. En post som saknar uppgifter eller en ägarkontroll registreras som behöver granskas i stället.",
  cancel: "Avbryt körningen",
  cancelHelp:
    "En avbruten körning behåller varje förberedd plan som bevis. En handläggare som redan arbetar slutar publicera sitt resultat.",
  notReconciled:
    "Körningen är inte en avstämd period. Besökta poster är ingen fullständighetsuppgift; källdokumentet och kontrollerna avgör det.",
  populationComplete: "Den avlästa källpopulationen var fullständig.",
  populationIncomplete: "Den avlästa källpopulationen var inte fullständig.",
  counts: "Posternas lägen",
  work: "Arbete",
  stateColumn: "Läge",
  owner: "Tilldelad ägare",
  plan: "Förberedd plan",
  batch: "Granskningspaket",
  missing: "Saknade uppgifter",
  refused: "Avvisad på grund av",
  visited: "Besökta",
  selected: "Urval",
  pending: "Ej påbörjat",
  waitingPredecessor: "Väntar på en tidigare post",
  needsReview: "Behöver granskas",
  prepared: "Förberedd",
  recovered: "Återhämtad",
  committed: "Bokförd",
  refusedState: "Avvisad",
  none: "Inget registrerat",
  identityMismatch: "Svaret hörde inte till den här boken och den här körningen.",
  empty: "Det här urvalet har inga poster.",

  batchTitle: "Granskningspaket",
  batchHelp:
    "Ett paket är en fast lista över redan förseglade planer som en enda mänsklig gest täcker. Det är inte en regel som släpper in en senare ankomst: ett arbete som tillkommer efter att paketet förseglades ingår inte, och ett arbete vars plan flyttats avvisas i stället för att godkännas på en annan uppsättning.",
  batchSelect: "Välj förberett arbete",
  batchSelectHelp:
    "Bara ett förberett arbete med en förseglad plan och sin ägarkontroll kan vara medlem. Ett arbete som väntar på ett tidigare arbete kan inte vara det förrän det arbetet bokförts.",
  batchNotWaiting: "Väntar på ett tidigare arbete",
  batchNotPrepared: "Ingen förseglad plan ännu",
  batchNoOwner: "Ingen ägarkontroll ännu",
  batchSelected: "valda",
  batchMaximum: (n: number) => `högst ${n} per paket`,
  batchSeal: "Försegla paketet",
  batchSealed: "Förseglat paket",
  batchCombined: "Sammanlagd effekt, informativt",
  batchCombinedNote:
    "Det sammanlagda beloppet visas för granskaren. Det är aldrig en verifikationsrad och aldrig en balanserande storhet.",
  batchDigest: "Förseglad kontrollsumma",
  batchMembers: "Medlemmar",
  review: "Ägarkontroll",
  receipt: "Kvitto",
  batchApprove: "Godkänn paketet",
  batchApproved: "Paketet är godkänt. Dess medlemmar kan nu köras via sina egna ägare.",
  batchAlreadyApproved: "Paketet var redan godkänt.",
  batchExecute: "Kör nästa medlemmar",
  batchExecuted: "Vad den här omgången gjorde",
  batchCommitted: "Bokförd",
  batchRefused: "Avvisad",
  batchNextPage: "Fortsätt från nästa medlem",
  batchNoMembers: "Inget förberett arbete att välja.",
  batchOperatorOnly:
    "Endast en operatör kan godkänna eller köra ett paket. Så här ser det förseglade paketet ut för en operatör.",
  batchAcknowledge:
    "Jag förstår att detta godkänner och bokför exakt den här uppsättningen av syntetiska effekter, och att en medlem vars ägare avvisar lämnas till granskning i stället för att köras om.",
};

const stateWords = {
  pending: "pending",
  waiting_predecessor: "waitingPredecessor",
  needs_review: "needsReview",
  prepared: "prepared",
  recovered: "recovered",
  committed: "committed",
  refused: "refusedState",
} satisfies Readonly<Record<ChildState, keyof typeof english>>;

export function periodWorkCopy(locale: Locale) {
  const text = locale === "sv" ? swedish : english;

  return {
    ...text,
    childState: (state: ChildState) => text[stateWords[state]],
  };
}
