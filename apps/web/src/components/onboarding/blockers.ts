import type { OnboardingView } from "./views";

type Task = { label: string; view: OnboardingView };

const tasks = {
  complete_company_fact_inventory_required: {
    label: "Företagsfakta behöver bekräftas",
    view: "profile",
  },
  full_capability_matrix_not_qualified: {
    label: "Kompatibilitet behöver kontrolleras",
    view: "compatibility",
  },
  source_coverage_not_established: {
    label: "Källornas täckning behöver kontrolleras",
    view: "sources",
  },
  historical_import_acceptance_required: {
    label: "Historisk import behöver accepteras",
    view: "import",
  },
  authoritative_opening_control_required: {
    label: "Ingående balanser behöver kontrolleras",
    view: "opening",
  },
  independent_book_zero_controls_required: {
    label: "Bokföringen behöver verifieras",
    view: "verification",
  },
  capability_responsibility_policy_required: {
    label: "Ansvar behöver sparas",
    view: "responsibilities",
  },
  accepted_book_zero_and_final_delta_required: {
    label: "Slutlig deltaimport behöver accepteras",
    view: "delta",
  },
  restore_and_single_writer_proof_required: {
    label: "Säkerhetskopia och tidigare systems skrivskydd behöver verifieras",
    view: "cutover",
  },
  authorized_writer_promotion_required: { label: "Övergången behöver bekräftas", view: "cutover" },
  authoritative_live_boundary_required: { label: "Startdatum behöver bekräftas", view: "cutover" },
  source_change_needs_decision: { label: "Ändrade källposter behöver beslut", view: "delta" },
  source_change_not_posted: { label: "Valda ändringar är ännu inte importerade", view: "delta" },
  source_delta_changed: {
    label: "Underlaget har ändrats. Granska deltaimporten igen",
    view: "delta",
  },
} satisfies Readonly<Record<string, Task>>;

export function onboardingBlocker(code: string): Task {
  const task = Object.entries(tasks).find(([key]) => key === code)?.[1];

  return task ?? { label: "Kontrollen behöver granskas", view: "verification" };
}
