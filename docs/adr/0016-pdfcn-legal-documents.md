# ADR 0016 — pdfcn legal document presentation

Status: Accepted owner decision, 2026-09-30.

## Context

The owner requires pdfcn and adaptation to OpenERP's use case. The owner also confirmed that there are no existing customer artifacts, customers or real database to preserve. The synthetic legal PDF templates can therefore be replaced directly. The issued accounting facts, immutable captures, artifact seals and credit recovery workflow already have application owners.

## Decision

Vendor the relevant React components from pdfcn at a pinned upstream revision, retain the MIT notice and compose them in the legal-invoice and credit-note application owners. Keep Takumi as the rendering engine and the existing bundled fonts. Use a fixed local theme, exact Swedish SEK strings, flowing A4 content and actual page counters. Presentation consumes retained facts and never recalculates accounting amounts.

The current public renderer identifiers are `openerp-se-invoice-pdfcn-v1` and `openerp-se-credit-note-pdfcn-v1`. Remove the superseded legal renderers and update credit renderer constraints by forward migration. The synthetic review PDF workflow remains separately owned. Browser styling continues to use StyleX.

Retaining the old legal renderers would add compatibility for artifacts the owner confirmed do not exist. Copying the unmodified sample would carry sample amounts, dollar formatting, mutable theme state and fixed page text into the product. Both are excluded by this decision.

## Consequences and proof

OpenERP owns the copied source and future adaptations. Upstream changes require a deliberate source review. Unsupported characters or incomplete facts fail visibly; a failed render must not issue, post or allocate another number. Replay and recovery retain the existing artifact and financial authority boundaries.

The [source record](../../apps/api/src/adapters/pdf/pdfcn/UPSTREAM.md) identifies the exact upstream files and revision. The [adoption record](../archive/completed/pdfcn-adoption.md) retains the failure contract, repeatable E2E command and observed results. Five public-API/Bun-queue E2E tests passed; independent PDF extraction and inspection covered exact amounts, frozen facts, pagination and credit recovery. These observations qualify the synthetic local implementation, not company readiness.
