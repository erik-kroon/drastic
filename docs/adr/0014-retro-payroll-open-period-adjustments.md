# Retroactive payroll corrections in an open accounting period

Status: working decision, selected by the user on 2026-09-28. Implementation, runtime verification and Swedish treatment qualification remain open.

## Context and decision

A payroll correction can concern a locked salary period without having that period as its accounting or declaration period. Keep three independent meanings: the original payroll period being corrected, the authorized accounting date of the adjustment, and the reporting period determined by the applicable declaration rules.

The default is a linked adjustment in an open accounting period. Preserve the original run, salary components, calculation, approval and posting; retain the correction reason, component-level difference and links to the resulting adjustment. Use a full reversal only when the selected correction treatment requires it. Do not hard-code today as the accounting date or infer declaration attribution from either accounting date or original payroll period.

Locked periods remain locked: payroll has no privileged posting bypass. Normal preparation, approval and atomic posting controls apply, including rechecking period state at execution. If the chosen period has closed, refuse and require a newly prepared and approved date rather than silently moving the posting.

Controlled reopening is a separate, explicitly authorized and recorded workflow, available only if supported and permitted by the qualified accounting policy. It is not the default payroll-correction route. Statutory reporting corrections also remain separate workflows; posting an adjustment does not amend, submit or establish acceptance of an employer declaration.

## Ownership and consequences

- PAY-03 / NEXT-36 own the correction and its financial lineage; COR-02 retains correction controls. Existing paid-payroll recovery, lawful-basis and withholding restrictions remain applicable.
- PAY-04 owns declaration identity, reporting-period treatment, amendment versions and external outcomes.
- PRY-132 owns database-level locked-period refusal; reopening does not weaken that invariant while a period remains locked.
- Readers show both the retained original-period close view and an explicitly labelled payroll-attribution view including subsequent corrections. The latter links to adjustment-period postings and never rewrites the original ledger, payslip, declaration or closed report.
- D-04 and D-08 require company applicability and current Swedish accounting/employer-declaration treatment review before company use. This decision selects system semantics, not a legal rule or an activated payroll profile.

## Alternatives and reference limits

Reopening the original period for every correction is rejected as the default. Elevated-authority writes into a still-locked period are rejected. Automatically dating every correction today or always reversing the entire run is also rejected.

The HRMS source trace at revision `727f3a4` observed correction documents and Journal Entry creation using the Payroll Entry posting date. That observation does not establish that every retroactive correction requires rerunning the original period, nor that HRMS lacks an alternative mechanism. The earlier conversational claim that it has “no third mechanism” is withdrawn; this decision does not depend on it. The ERPNext/Frappe review remains reference input, not Swedish treatment evidence.

## Required proof before release

Retain repeatable end-to-end evidence for an August correction posted on an authorized open September date: August's original bytes and ledger remain unchanged; the adjustment and original components are linked; both reader views reconcile. Also demonstrate locked-date refusal, a period closing after preparation, fresh approval after changing the date, exact-key recovery without duplicate effects, and atomic failure without partial payroll/register effects. Verify a partial adjustment without unnecessary full reversal and the qualified full-reversal case separately. A posting must not change declaration state; reporting attribution and any amendment need independent reviewed examples and retained original artifacts.

These are acceptance obligations, not newly added tests or claims of executed proof.

Historical planning links and captures omitted from this source distribution remain in the private working archive.
