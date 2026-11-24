# AmiBot RAG evaluations

Open **AmiBot Admin → RAG evaluations** (`/amibot-admin/evals`) after deploying both the API and UI. Existing admin authentication protects the page and every API endpoint. No new service, API key, or dependency is required. MongoDB creates the new `AmiBotEvalCase` and `AmiBotEvalRun` collections on first write.

## Start with a meaningful suite

1. Add a real visitor question and a short test name.
2. Choose the expected behavior: answer from knowledge, admit missing knowledge, or give a casual reply.
3. For a knowledge answer, select its supporting passages and enter short expected facts, one per line. Prefer distinctive names, numbers, or titles. A reference answer is optional and is shown for human review, not automatically graded.
4. Add earlier user/bot messages for a follow-up question.
5. Run the suite, then inspect both failed and passing answers. Edit expectations if a correct paraphrase fails a phrase check. Fix retrieval or source content when the supporting passage is absent.

Use up to 30 cases across factual questions, paraphrases, follow-ups, missing information, and greetings. The suite starts empty because only the knowledge owner can define trustworthy expectations for their actual uploaded records. The synthetic offline fixtures are never inserted into live knowledge or displayed as real scores.

## Understand the scores

| Check | Passing rule | Limits |
| --- | --- | --- |
| Answer behavior | Actual route is `knowledge`, `unknown`, or `direct`, matching the expectation. | This tests the pipeline decision, not factual truth. |
| Expected facts | Every expected phrase occurs with word boundaries, after Unicode normalization and case/punctuation folding. | No synonym, entailment, or negation detection. Additional unsupported claims can still pass. |
| Evidence in context | All selected chunk IDs are present in full in the actual model context. | An available source is not a verified claim-level citation. Truncated or excluded passages do not pass. |

Every configured check must pass for a case to pass. `error` means execution could not be evaluated, including degraded retrieval or malformed model output; it cannot count as a correct refusal. Overall pass rate is passed / completed cases, **including errors in the denominator**. Per-check rates exclude errors and cases where that check does not apply. Empty denominators are `null` / a dash, never 100%.

The export includes first relevant retrieval rank and reciprocal rank (`1/rank`; zero when missing). Mean reciprocal rank averages over evaluated knowledge cases. Response-time p95 uses the nearest-rank percentile over completed non-error cases and measures retrieval + generation, excluding HTTP and saving overhead.

These are deterministic regression checks, **not semantic correctness or faithfulness scores**. Always review the reference, actual answer, and context for unsupported claims. There is no hidden LLM judge.

## Execution and reproducibility

`resolveAmiBotAnswer` is shared by chat and live evaluations. It runs the current keyword/embedding retrieval, conversation normalization, context formatting, grounded prompt, and model. It has no chat-history, question-queue, or email side effects. The public chat handler retains those behaviors separately.

Each run snapshots its case definitions, evaluator version, suite fingerprint, runtime settings, knowledge count/update marker, answers, actual model, and ordered evidence. Comparison deltas appear only for completed runs with identical suite fingerprints and evaluator versions. Corpus and model changes are deliberately allowed, so inspect run configuration when interpreting a delta. The corpus is not transactionally frozen: avoid editing knowledge during a run. Model output can vary between identical requests.

The browser executes one persisted case per HTTP request. An atomic pending → running claim prevents duplicate evaluation of the same case. Pause finishes the current case; resume executes remaining pending cases. Closing the page stops scheduling new cases. The current server request may still finish. Reload the run before resuming after a connection failure. A running case older than five minutes is marked as an execution error when the run is read; start a new run to retry errored cases. There is no background queue requirement.

Runs may incur normal Gemini API costs. Execution/run creation is rate limited. The UI shows the most recent 20 runs; saved runs and historical evidence persist until a separate retention policy is introduced. Deleting a test case does not delete its historical run snapshots.

## Offline regression command and CI

```sh
npm run eval:amibot
npm run eval:amibot -- --json
node --test test/amibotEvals.test.js test/amibotEvalController.test.js test/amibotKnowledge.test.js test/amibotController.test.js test/amibotFallback.test.js
```

The 14 versioned cases in `evals/amibot/fixtures.js` use a synthetic profile and fixed vectors. They exercise the production ranker, query normalization, follow-up weighting, multi-record retrieval, irrelevant queries, semantic-only matches, and direct replies. They make no DB/network/model calls and fail the process on regressions. They do not measure embedding-model quality, Mongo candidate selection, or generated-answer quality. Controller tests cover the shared pipeline and HTTP authorization with stubbed external boundaries. `.github/workflows/amibot-evals.yml` runs the offline suite and relevant tests for pull requests and feature/main pushes.

## API

All routes live under `/api/amibot/admin/evals` and use the existing bearer token and admin guard.

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/cases` | List / create cases |
| PUT / DELETE | `/cases/:id` | Edit / remove a case |
| GET | `/evidence?q=...` | Search up to 25 active passages using escaped literal text |
| GET / POST | `/runs` | Recent run summaries / snapshot a new run |
| GET | `/runs/:id` | Full run with results and evidence |
| POST | `/runs/:id/cases/:caseId` | Execute one pending saved case |

Knowledge cases require at least one expected fact and one active evidence ID. Input sizes, history roles, outcomes, and IDs are validated. Full snapshots are available through the UI’s JSON download. Saved runs use server-side definitions; the execution endpoint never trusts a client-supplied answer or score.
