# Independent shadow-evaluation expectations (AUT-12)

These authored expectations precede the evaluation implementation. Synthetic labels establish the mechanism, not model quality or permission to automate. A label is independent only when its retained provenance proves the reviewer did not see the tested suggestion. The model never supplies its own gold label.

For a choice question, use the multiclass Brier score `sum((probability - oneHotLabel)^2)` without dividing by the number of options. A response retains the complete admitted option universe. Different universes, question releases or model identities cannot silently share a calibration population.

| Authored distribution and independent label | Required Brier score |
| --- | --- |
| `[1, 0]`, label first option | 0 |
| `[0.5, 0.5]`, label first option | 0.5 |
| `[0.7, 0.2, 0.1]`, label first option | 0.14 |
| `[0.7, 0.2, 0.1]`, label second option | 1.14 |
| The preceding two three-option examples together | Mean 0.64 |
| `[0.9, 0.1]`, label second option | 1.62 |

For the two three-option examples, the highest-probability option is the first in both cases. A reliability bin containing them has two observations, mean predicted probability 0.7 and observed correctness 0.5. The vendor confidence statistic is neither of those values nor an observed accuracy estimate.

| Synthetic history or result | Required observation |
| --- | --- |
| No independent labels | Zero eligible labels; accuracy, Brier score and uncertainty unavailable |
| One request is delivered or evaluated twice | One example; request identity deduplicates retries |
| Same idempotency key has different immutable input | Refusal, not a second evaluation example |
| Reviewer saw the tested suggestion before deciding | Counted exposed; excluded from independent quality denominator |
| Exact account differs, retained consequence class agrees | Exact-account incorrect; consequence correct |
| Either consequence class is unknown | Counted unknown; excluded from known-comparable accuracy |
| Candidate exact source span has decimal punctuation and leading zeros | Selected span bytes remain exact; no generated or normalized amount |
| Candidate selection returns `none` | Explicit abstention, counted separately from a correct candidate selection |
| More than 255 options including escape options | Explicit skip; no truncation or candidate substitution |
| Bank alternatives include `none` and `split` | Retained choices are claims; no match, deduplication or posting follows |
| Account/VAT option is absent from the frozen book/profile inventory | Cannot enter the request or become a scored valid prediction |
| Two examples share a document/correction lineage | Stay in one evaluation group; do not count as independent groups |
| Precedent or label exists only after the target cutoff | Excluded from target state and memory baseline |
| Fixture result is confident and disagrees with independent label | Counted as an error; never relabelled to match the model |

Reports retain total requests, skips and diagnostics, unique completed results, all labels, exposed/excluded labels, independent eligible labels, predictions/abstentions, exact-account comparable/correct counts, known-consequence comparable/correct counts and unknown consequences. Every metric names its denominator. Grouped uncertainty names its method, grouping key, confidence level and number of independent groups; insufficient groups produce an unavailable interval rather than an invented guarantee.

The memory comparison uses the same target cutoff, label eligibility and groups. A fixture score cannot establish that Clef or Jev beats memory. Reports pin question/builders, model identity and configured release, option/input digests, label provenance and evaluation algorithm. They do not grant a mandate or substantiate immutable hosted weights.
