# Independent decision protocol expectations (AUT-09)

These synthetic expectations precede implementation. A validated distribution remains an unreviewed claim; its statistics confer no authority. Source amounts may only be selected from retained spans. A score is a rubric position, never an accounting amount.

| Authored distribution | Expected confidence | Expected top / margin or score |
| --- | --- | --- |
| Choice [1, 0] | 1 | top 1, margin 1 |
| Choice [0.5, 0.5] | 0 | top 0.5, margin 0 |
| Choice [0.6, 0.3, 0.1] | 0.4 | top 0.6, margin 0.3 |
| Choice [0.6, 0.2, 0.2] | 0.4 | top 0.6, margin 0.4 |
| Noul yes 0.5 | 0 | top 0.5, margin 0 |
| Noul yes 0.9 | 0.8 | top 0.9, margin 0.8 |
| Score [0, 0.5, 0.5] | 0.25 | score 1.5 |
| Score [0.5, 0, 0.5] | 0 | score 1 |
| Score [0.9, 0.1] | 0.8 | score 0.1 |

Floating probability comparisons use a declared small tolerance, without silently normalizing malformed distributions. Score ties use the first maximum index in the ordered rubric.

Preimplementation refusal/skip expectations:

- A choice with 255 options including its unknown option is admitted; 256 is explicitly skipped, never truncated.
- Missing/extra question IDs, response option IDs or score-level indices are refused.
- Missing full distribution, negative/nonfinite/out-of-range probabilities or an invalid sum are refused.
- A chosen option outside the declared set or below the maximum probability is refused; a genuine tie may select either tied maximum.
- Question/answer kind mismatch and unexpected reported model identity are refused.
- A score outside the rubric or inconsistent with its distribution is refused.
- Invalid score cardinality (outside 2–10) is refused; provider requests use the common maximum of 64 questions.
- Empty/duplicate declared options or absent explicit unknown/none for a choice are refused. Missing input is an explicit status, not invented evidence.
- Reordering unordered choice keys preserves the question/option content digest; changing criteria or builder versions changes it.
- Catalog reads require admitted book access and expose server-authored releases; clients cannot publish criteria through a read.

Primary protocol references checked 2026-10-10: [TypeSafe API](https://docs.typesafe.ai/api), [confidence formula](https://docs.typesafe.ai/confidence), [models](https://docs.typesafe.ai/models), and [Cloudflare Clef-flash binding](https://developers.cloudflare.com/workers-ai/models/clef-flash/). Hosted Clef docs identify the model selector but do not establish an immutable weight revision in this investigation; adapter qualification must distinguish these facts.
