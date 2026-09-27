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
