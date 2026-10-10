# ADR 0021 — Layered accounting automation, decision models and firm learning

Status: accepted direction, 2026-10-10. The owner accepted the layered approach, firm
learning as a core opt-in product capability, and starting provenance and firm memory
now. The legal footing, provider data use and the bars for suggest mode and mandates
remain open under AUT-00. No model is called, trained or served by the current product. This record claims no accuracy, calibration, time saving,
legal clearance or provider qualification. Delivery is planned as issues in the
[automation handoff](../operations/automation-handoff-2026-10-10.md).

## Context

ADR 0017 makes bureau bookkeeping the commercial wedge and keeps automatic posting
unadopted. ADR 0020 added a per-book authority policy, presence proof and bounded
mandates, so a person can authorize a class of work in advance.

The open question is how Drastic should automate accounting. Several approaches are
available:

- **Rules:** user-authored mappings.
- **Structured facts at the source:** Peppol, bank references, own invoicing and payments.
- **Deterministic firm memory and precedent.**
- **Decision models:** calibrated choice over a closed option set, such as TypeSafe's Jev
  and Cloudflare's open-weight Clef.
- **Fine-tuned firm models.**
- **General language-model agents.**
- **Shared counterparty knowledge.**
- **Verification-first automation:** catch errors rather than predict better.

Each automates a different part of the work. The company thesis expects code to become
cheap; what stays scarce is verified correctness and a firm's accumulated judgement.

Drastic already holds the material that makes learning trustworthy:

- immutable, commit-ordered decisions with correction lineage (I-03, I-10);
- independent reconciliation (I-11);
- exact approval binding.

It also already shows suggestions today: supplier account history, extraction field
proposals and bank candidate ranking. So the decisions recorded now are not all made
without assistance.

## Decision

### 1. Automate in layers; each layer shrinks the next

1. **Facts.** Prefer structured channels to inference. A Peppol invoice, a referenced
   bank payment or Drastic's own invoice removes a whole class of judgement.
2. **Memory.** Deterministic firm memory gives precedent from the book's own approved
   decisions. Public counterparty facts (industry code, VAT registration) supply a
   starting point where there is no history.
3. **Judgement.** Decision models answer bounded questions. The book's precedent is part
   of their input. Firm adapters are a scaling step once data supports them.
4. **Orchestration.** Language-model agents chase documents, ask questions and explain.
   They create claims and questions; they never post.
5. **Verification.** Independent reconciliation, invariants and anomaly checks. This
   layer, not model accuracy, earns autonomy.
6. **Ratification.** Recurring learned patterns become explicit rules that a person
   activates. Mandates cover only classes whose consequential error has been measured.
7. **People.** Exceptions, accountability and the external gestures reserved to a person
   (ADR 0020).

### 2. Model output is a claim, never authority

A **question release** is asked about one subject revision. Its id, version, kind,
criteria, option-builder and state-builder versions are digested together. Drastic builds
the options from the book's own records. The model's distribution is stored as an
unreviewed claim, with the model release, the request digests and the full distribution.

- Models never post, approve, pay, sign or file.
- Amounts are selected from exact source spans, never produced.
- No model is called inside an approval or posting transaction. Execution reads a stored
  result.
- Each question runs per book in one mode, set only by the operator console:
  - `off`;
  - `shadow`, for evaluation only;
  - `suggest`, shown with provenance in review;
  - a **mandate condition** under ADR 0020.

### 3. Correctness is judged by accounting consequence

Two treatments are **consequence-equivalent** when they agree on all of:

- the report line under the book's statement mapping;
- VAT category and deductible share;
- accounting period;
- balance-sheet or income-statement placement;
- required dimensions.

Evaluation, firm memory and mandate terms use consequence classes. Exact account match is
reported beside them, never instead of them. Partially deductible treatments (for
example, representation) are never equivalent to fully deductible ones.

### 4. Learned knowledge is stored as categories

VAT and similar treatments are learned and suggested as **categories**. The versioned rule
profile turns a category and a tax point into a rate and a deduction, so a change in law
does not corrupt what was learned. Today's reviewed treatments store a rate and a
deduction; moving to categories is a change for the VAT owner (see the
[VAT profile boundary](0002-swedish-vat-profile-boundary.md)).

### 5. Every label records what the person saw

Each human decision records a **provenance class** in the same transaction as the
decision. The class is derived on the server, and the client cannot claim
independence:

| Class | Meaning |
| --- | --- |
| `independent` | No suggestion was served for this subject to this person |
| `accepted_unchanged` | A suggestion was shown and kept |
| `corrected` | A suggestion was shown and changed |
| `batch_approved` | Approved in a bounded batch |
| `unknown_exposure` | A suggestion was served but the decision did not cite it |
| `historical_import` | SIE history without source documents |

How each class is used:

- **Evaluation** uses only `independent` and `corrected`.
- **Training** down-weights `accepted_unchanged` and `batch_approved`.
- A per-book **exploration share** keeps independent labels arriving after suggestions
  ship.

Provenance cannot be reconstructed afterwards, so it starts before any model.

### 6. Firm learning follows the data flow, and every widening is opt-in

| Scope | Data flow | Consent |
| --- | --- | --- |
| Same book | A book's own precedent helps that book | Treated as the bookkeeping service itself; counsel to confirm |
| Same firm | One client's decisions help another client of the same firm | The firm enrols, and each book separately authorizes *contribute* and *use*, citing the client company's instruction; the client sees and can revoke |
| Across firms | Supplier-level, non-personal knowledge, aggregated so no firm is identifiable | Separate addendum; out of scope until decided |

**Precedent retrieval** comes first. The firm's most similar past decisions go into the
decision-model state. It needs no training, works with any compatible provider, and
revocation takes effect immediately: retrieval stops.

**Firm adapters** come later. A firm adapter is a low-rank adapter on pinned open Clef
weights, trained on contributing books once a firm has enough clean labels and retrieval
has plateaued. Jev offers no customer fine-tuning, so it cannot serve this role.

**Data minimisation:** state builders exclude or redact payroll, employee claims,
personal identity numbers, private individuals' names, free-text client messages, and
all audio and video.
Training copies are not the statutory archive.

The working legal assumption is that the client company is controller, the bureau a
processor and Drastic a sub-processor. Counsel must confirm the same-book and same-firm
bases before any real book is used.

### 7. Learned, then ratified

When firm memory or a model finds a stable pattern, Drastic proposes an explicit rule
through the existing rule owner. The proposal cites its supporting decisions and its
counterexamples. A person activates the rule, and it then proposes deterministically.
Rules never activate themselves (R-10).

### 8. Firm adapter releases

A release is identified by:

- the base-weights digest;
- the adapter digest;
- the training-manifest digest;
- the question releases;
- the evaluation report.

**Training input:** the training manifest is immutable. It lists every included book's
authorization revision and records each exclusion with counts. It is exported as a
bundle encrypted under per-firm and per-book keys. The training service, a separate
Python deployable, reads only that bundle and never the database.

**Promotion:** a release is promoted only when, on held-out `independent` and `corrected`
labels, it:

- beats firm memory and the unadapted base on consequence accuracy;
- meets the calibration bar;
- does not regress on new counterparties;
- passes membership canaries.

Promotion is a firm-admin gesture with presence proof, and rollback is immediate. A new
release does not inherit a mandate; the mandate must be granted again.

**Revocation:**

- Excluded data never enters a new manifest.
- Releases trained on revoked data are retired within a stated window.
- Training keys for revoked data are destroyed.

### 9. Autonomy is granted per consequence class, with evidence

Mandates (ADR 0020) may gain:

- terms over consequence classes;
- decision conditions: question release, model release, and a threshold or a
  single-option prediction set;
- a verification-coverage requirement for the book.

Each decision condition cites an immutable calibration record with a stated error bound
from independent labels. Automatic posting remains unadopted outside a granted mandate
(ADR 0017).

## Alternatives rejected

- **A generative model writing entries:** values can be invented, and the output cannot
  be bounded.
- **Exact-account accuracy as the target:** it optimizes distinctions with no
  consequence.
- **Learning rates instead of categories:** a single law change invalidates the history.
- **Fine-tuning before retrieval:** heavier consent and unlearning for an unproven gain.
- **Pooling firms by default.**
- **Training without provenance:** creates an echo loop.
- **Promotion on provider confidence.**
- **Keeping a firm's model as lock-in:** decisions stay exportable.

## Consequences

Provenance, consequence classes, firm memory, anomaly checks and rule ratification are
deterministic and deliver value without a model. Decision models add a provider adapter,
background jobs, an evaluation obligation per question and release, and a data-use
decision per provider. Firm adapters add a training service, a legal addendum and key
management. The compounding effect of firm learning is a hypothesis. It is measured per
firm as the unchanged-approval share, touches per transaction and consequential error,
before and after each change.

## Proof that would validate this

- E2E showing that provenance is derived on the server and cannot be forged.
- Evaluation exports that refuse post-cutoff, payroll and unauthorised data, checked
  with canaries.
- Shadow non-interference with a fixture provider.
- Ratified rules with retained supporting evidence.
- A time-split evaluation on Drastic AB's own books against firm memory, with
  denominators.
- A pilot bureau under a signed addendum, in shadow before any suggestion is shown.
