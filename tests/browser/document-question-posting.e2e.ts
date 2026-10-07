import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as Schema from "effect/Schema";
import { test, type Browser, type WebResponse } from "@e2e-dev/web";
import { expect, type Locator, type Screen } from "e2e";
import * as Accounting from "../../packages/contracts/src/accounting";
import * as Commerce from "../../packages/contracts/src/commerce";
import * as Source from "../../packages/contracts/src/source-intake";
import * as Inbox from "../../packages/contracts/src/supplier-inbox";
import * as Workspace from "../../packages/contracts/src/workspace";
import * as Acceptance from "../../packages/contracts/src/supplier-acceptance";
import * as Cases from "../../packages/contracts/src/cases";
import * as Bank from "../../packages/contracts/src/reconciliation";
import * as Candidates from "../../packages/contracts/src/bank-match-candidates";
import * as Settlement from "../../packages/contracts/src/settlements";
import { signInSyntheticOperator } from "./synthetic-session";
import { twoPageOriginal } from "./original-fixture";

function hash(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function browserGeometry(browser: Browser) {
  return browser.evaluate<{ dpr: number; width: number; height: number }>(
    "() => ({ dpr: window.devicePixelRatio, width: window.innerWidth, height: window.innerHeight })",
  );
}

async function nativeReviewZoom(
  browser: Browser,
  screen: Screen,
  filename: string,
  capture: () => Promise<string>,
) {
  await browser.keyboard.press("ControlOrMeta+0");

  const baseline = await browserGeometry(browser);

  try {
    for (let step = 0; step < 5; step++) await browser.keyboard.press("ControlOrMeta+Equal");

    const observed = await browserGeometry(browser);
    const dprRatio = observed.dpr / baseline.dpr;
    const widthRatio = baseline.width / observed.width;
    const qualified = Math.abs(dprRatio - 2) < 0.02 && Math.abs(widthRatio - 2) < 0.04;

    if (qualified) {
      await expect(screen.getByRole("combobox", "Sida", { exact: true })).toContainText("2 av 2");
      await expect(screen.getByRole("combobox", "Zoom", { exact: true })).toContainText("125 %");
      await expect(screen.getByRole("img", `${filename}, sida 2`)).toBeVisible();
      await screen.getByRole("button", "Beslut", { exact: true }).focus();
      await screen.getByRole("button", "Beslut", { exact: true }).press("Enter");
      await expect(
        screen.getByRole(
          "checkbox",
          "Jag förstår att detta bokför förslaget utan att fastställa momsbehandling.",
          { exact: true },
        ),
      ).toBeChecked();
      await screen.getByRole("button", "Original", { exact: true }).focus();
      await screen.getByRole("button", "Original", { exact: true }).press("Enter");
      await expect(
        screen.getByText("Independent original page two", { exact: true }),
      ).toBeVisible();
    }

    return {
      baseline,
      observed,
      dprRatio,
      widthRatio,
      qualified,
      outcome: qualified
        ? "native_200_percent_access_verified"
        : "native_zoom_shortcut_did_not_establish_200_percent",
      screenshot: await capture(),
    };
  } finally {
    await browser.keyboard.press("ControlOrMeta+0");

    const restored = await browserGeometry(browser);

    expect(Math.abs(restored.dpr - baseline.dpr)).toBeLessThan(0.01);
    expect(Math.abs(restored.width - baseline.width)).toBeLessThanOrEqual(2);
  }
}

async function decodedResponse<S extends Schema.Top & { readonly DecodingServices: never }>(
  response: Promise<WebResponse>,
  schema: S,
): Promise<S["Type"]> {
  const result = await response;

  expect(result.status).toBe(200);

  return Schema.decodeUnknownSync(schema)(await result.json());
}

async function inspectAnsweredQuestionPane(
  browser: Browser,
  screen: Screen,
  readable: typeof Source.SourceOccurrence.Type,
  taskTitle: string,
  capture: (label: string) => Promise<string>,
) {
  const dialog = screen.getByRole("dialog", "Frågor att besvara", { exact: true });

  const attachment = browser.locator('[role="dialog"] summary').filter({
    hasText: readable.filename,
  });

  await browser.setViewport({ width: 1440, height: 900 });
  await expect(browser.locator("[data-question-task-context]")).toContainText(taskTitle);
  await expect(dialog.getByText("Besvarad", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", "Markera som löst", { exact: true })).toBeEnabled();
  await dialog.getByRole("button", "Uppdatera", { exact: true }).scrollIntoView();
  await dialog.getByRole("button", "Stäng", { exact: true }).focus();

  const desktop = await dialog.boundingBox();

  if (!desktop) throw new Error("The actual question pane has no desktop geometry");

  expect(desktop.width).toBe(420);
  expect(desktop.x + desktop.width).toBe(1440);

  const desktopScreenshot = await capture("document-question-task-pane-answered-desktop");

  await expect(attachment).toHaveText(`${readable.filename} Sparad i Dokument`);
  await attachment.focus();
  await attachment.press("Enter");
  await expect(
    dialog.getByRole("img", `${readable.filename}, sida 1`, { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", "Sidtext", { exact: true }).focus();
  await dialog.getByRole("button", "Sidtext", { exact: true }).press("Enter");
  await expect(dialog.getByText("Independent original page one", { exact: true })).toBeVisible();

  const attachmentScreenshot = await capture("document-question-task-pane-readable-attachment");

  await attachment.focus();
  await attachment.press("Enter");
  await expect(dialog.getByText("Independent original page one", { exact: true })).toBeHidden();
  await browser.setViewport({ width: 320, height: 800 });
  await dialog.getByRole("button", "Uppdatera", { exact: true }).scrollIntoView();
  await expect(dialog.getByText("Besvarad", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Kan inte öppnas", { exact: true })).toBeVisible();
  await attachment.scrollIntoView();

  const narrow = await dialog.boundingBox();

  const page = await browser.evaluate<{ width: number; scrollWidth: number }>(
    "() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth })",
  );

  if (!narrow) throw new Error("The actual question pane has no narrow geometry");

  expect(narrow.width).toBe(320);
  expect(narrow.x).toBeGreaterThanOrEqual(0);
  expect(narrow.x + narrow.width).toBeLessThanOrEqual(page.width);
  expect(page.scrollWidth).toBeLessThanOrEqual(page.width);
  await dialog.getByRole("button", "Uppdatera", { exact: true }).scrollIntoView();
  await dialog.getByRole("button", "Stäng", { exact: true }).focus();

  const narrowScreenshot = await capture("document-question-task-pane-answered-320");

  await browser.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(browser.locator("[data-question-task-context]")).toHaveCount(0);

  const entry = screen.getByRole("button", "Frågor att besvara (1)", { exact: true });

  await expect(entry).toBeFocused();
  await entry.press("Enter");
  await expect(dialog.getByText("Besvarad", { exact: true })).toBeVisible();
  await browser.setViewport({ width: 1440, height: 900 });

  return { desktop, narrow, page, desktopScreenshot, attachmentScreenshot, narrowScreenshot };
}

async function upload(screen: Screen, browser: Browser, file: string) {
  await expect(screen.getByLabel("Dokument", { exact: true })).toBeVisible();
  await screen.getByLabel("Dokument", { exact: true }).setInputFiles(file);
  const response = browser.waitForResponse("**/source-occurrences");

  await screen.getByRole("button", "Spara original", { exact: true }).click();

  return decodedResponse(response, Source.SourceOccurrence);
}

async function reply(screen: Screen, browser: Browser, questionId: string, text: string) {
  const form = screen.getByRole("form", "Komplettera svaret", { exact: true });

  await form.getByRole("textbox", "Svar", { exact: true }).fill(text);
  const response = browser.waitForResponse(`**/workspace/questions/${questionId}/answers`);

  await expect(form.getByRole("button", "Komplettera svaret", { exact: true })).toBeEnabled();
  await form.getByRole("button", "Komplettera svaret", { exact: true }).click();

  return decodedResponse(response, Workspace.WorkQuestionResult);
}

async function partyDetails(editor: Locator, title: string, name: string) {
  await editor.getByText(title, { exact: true }).click();
  await editor.getByLabel("Fakturanamn", { exact: true, visible: true }).fill(name);
  await editor
    .getByLabel("Fakturaadress", { exact: true, visible: true })
    .fill("Synthetic address 1");
  await editor.getByLabel("Organisationsnummer", { exact: true, visible: true }).fill("SYNTHETIC");
  await editor.getByLabel("Landskod", { exact: true, visible: true }).fill("SE");
  await editor.getByText(title, { exact: true }).click();
}

async function fillDraft(screen: Screen, supplier: string, filename: string) {
  const editor = screen.getByRole("dialog", "Ny leverantörsfaktura", { exact: true });

  await expect(editor.getByLabel("Sök leverantör", { exact: true })).toBeVisible();
  await editor.getByLabel("Sök leverantör", { exact: true }).fill(supplier);
  await editor.getByRole("button", supplier, { exact: true }).click();
  await partyDetails(editor, "Leverantörens fakturauppgifter", supplier);
  await partyDetails(editor, "Fakturamottagare", "Synthetic question buyer");
  await editor.getByRole("textbox", "Beskrivning", { exact: true }).fill(filename);
  await editor
    .getByLabel("Leverantörens fakturanummer", { exact: true })
    .fill("QUESTION-ORIGINAL-01");
  await editor.getByLabel("Total enligt fakturan, SEK", { exact: true }).fill("1250,00");
  await editor.getByLabel("Fakturadatum", { exact: true }).fill("2026-10-03");
  await editor.getByLabel("Förfallodatum", { exact: true }).fill("2026-10-14");
  await editor.getByLabel("Leveransdatum", { exact: true }).fill("2026-10-03");
  await editor.getByLabel("Betalningsvillkor", { exact: true }).fill("Synthetic terms");
  await editor.getByRole("textbox", "Beskrivning 1", { exact: true }).fill(filename);
  await editor.getByLabel("Antal 1", { exact: true }).fill("1");
  await editor.getByLabel("Enhetspris 1", { exact: true }).fill("1250,00");
  await editor.getByLabel("Exkl. moms 1", { exact: true }).fill("1250,00");
  await editor.getByLabel("Momsbelopp 1", { exact: true }).fill("0");
  await editor.getByRole("button", "Moms och underlag", { exact: true }).click();
  await editor.getByLabel("Momsbehandling", { exact: true }).fill("Synthetic no tax treatment");
  await editor
    .getByLabel("Avtalat radbelopp inkl. moms (valfritt)", { exact: true })
    .fill("1250,00");
  await editor
    .getByLabel("Vad granskades mot originalet?", { exact: true })
    .fill(
      "Inspected both pages of the immutable original and explicitly closed its missing-original question",
    );

  return editor;
}

test("a retained original returns through questions, explicit review, posting and bank allocation", async ({
  app,
  browser,
  screen,
  agent,
}) => {
  const output = process.env.OPENERP_E2E_OUTPUT;

  if (!output) throw new Error("Use the disposable synthetic browser launcher");

  const workspace = await signInSyntheticOperator(browser, app.baseUrl);
  const origin = new URL(workspace).origin;
  const base = workspace.replace(origin, `${origin}/api/v1`);
  const cookie = (await browser.cookies()).map((item) => `${item.name}=${item.value}`).join("; ");

  const call = async <S extends Schema.Top & { readonly DecodingServices: never }>(
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<S["Type"]> => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        origin,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    const text = await response.text();

    expect(response.status).toBe(200);

    return Schema.decodeSync(Schema.fromJsonString(schema))(text);
  };

  const team = await call("/workspace", Workspace.Coordination);

  const operator = team.members.find(
    (member) => member.id === team.actorId && member.role === "operator",
  );

  if (!operator)
    throw new Error("The current synthetic session must have actual operator membership");

  const suffix = process.env.OPENERP_DEMO_FIXTURE === "1" ? "funding-demo-v1" : randomUUID();
  const filename = `question-original-${suffix}.pdf`;
  const originalBytes = twoPageOriginal();
  const originalFile = join(output, filename);
  const malformedBytes = Buffer.from("%PDF-1.4\nThis retained reply has no readable PDF pages");
  const malformedFile = join(output, `question-malformed-${suffix}.pdf`);
  const replacementFile = join(output, `question-readable-${suffix}.pdf`);

  await writeFile(originalFile, originalBytes);
  await writeFile(malformedFile, malformedBytes);
  await writeFile(replacementFile, originalBytes);
  const before = await call("/ledger", Accounting.LedgerSnapshot);

  await app.open(`${workspace}/purchases?view=supplier-drafts`);
  await expect(screen.getByRole("button", "Ladda upp original", { exact: true })).toBeVisible({
    timeout: 90000,
  });
  await screen.getByRole("button", "Ladda upp original", { exact: true }).click();
  const occurrence = await upload(screen, browser, originalFile);

  expect(occurrence.sha256).toBe(hash(originalBytes));

  const queue = `${workspace}/work?kind=document&status=open&q=${encodeURIComponent(filename)}`;

  await app.open(queue);
  await expect(screen.getByRole("button", "Tilldela", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Tilldela", { exact: true }).click();
  await screen
    .getByRole("dialog", filename, { exact: true })
    .getByRole("button", "Frågor att besvara", { exact: true })
    .click();
  const questionDialog = screen.getByRole("dialog", "Frågor att besvara", { exact: true });
  const ask = questionDialog.getByRole("form", "Ställ en fråga", { exact: true });

  await expect(ask.getByRole("button", "Ställ en fråga", { exact: true })).toBeVisible();
  await ask.getByRole("combobox", "Fråga", { exact: true }).click();
  await expect(screen.getByRole("option", "Originalet saknas", { exact: true })).toBeVisible();
  await screen.getByRole("option", "Originalet saknas", { exact: true }).click();
  await ask.getByRole("combobox", "Till", { exact: true }).click();
  await expect(screen.getByRole("option", operator.name, { exact: true })).toBeVisible();
  await screen.getByRole("option", operator.name, { exact: true }).click();
  await ask
    .getByRole("textbox", "Fråga", { exact: true })
    .fill("Please supply a readable retained copy before reviewing this same original");
  const askedResponse = browser.waitForResponse("**/workspace/questions");

  await ask.getByRole("button", "Ställ en fråga", { exact: true }).click();
  const asked = await decodedResponse(askedResponse, Workspace.WorkQuestionResult);

  expect(asked.question.root.recordId).toBe(occurrence.id);
  expect(asked.question.state).toBe("open");
  await expect(
    questionDialog.getByRole("button", "Ladda upp nytt kvitto", { exact: true }),
  ).toBeVisible();
  await questionDialog.getByRole("button", "Ladda upp nytt kvitto", { exact: true }).click();
  const malformed = await upload(screen, browser, malformedFile);

  const brokenReply = await reply(
    screen,
    browser,
    asked.question.id,
    "This supplied copy must be physically inspected",
  );

  expect(malformed.sha256).toBe(hash(malformedBytes));
  expect(brokenReply.question.state).toBe("open");
  expect(brokenReply.question.waitingOn).toBe(team.actorId);
  expect(brokenReply.question.events.at(-1)?.attachments[0]?.availability).toBe("unreadable");
  await expect(questionDialog.getByText("Kan inte öppnas", { exact: true })).toBeVisible();
  await expect(questionDialog.getByText("Väntar på dig", { exact: true })).toBeVisible();
  await expect(questionDialog.getByRole("button", "Markera som löst", { exact: true })).toHaveCount(
    0,
  );
  await agent.assert(
    "The question remains unresolved after the supplied PDF cannot be opened, and responsibility is visibly back with the asker (Väntar på dig). Return only the configured JSON judgment.",
    { timeout: 30000 },
  );
  const missingScreenshot = await app.screenshot("document-question-malformed-return-to-asker");

  await app.open(queue);
  await screen.getByRole("button", "Frågor att besvara (1)", { exact: true }).click();
  await questionDialog.getByRole("button", "Ladda upp nytt kvitto", { exact: true }).click();
  const readable = await upload(screen, browser, replacementFile);

  const answered = await reply(
    screen,
    browser,
    asked.question.id,
    "Inspected this independent retained two-page copy",
  );

  expect(readable.id).not.toBe(occurrence.id);
  expect(readable.sha256).toBe(occurrence.sha256);
  expect(answered.question.state).toBe("answered");
  expect(answered.question.waitingOn).toBe(team.actorId);
  expect(answered.question.events.at(-1)?.attachments[0]?.availability).toBe("readable");
  await expect(questionDialog.getByText("Besvarad", { exact: true })).toBeVisible();

  const questionPane = await inspectAnsweredQuestionPane(
    browser,
    screen,
    readable,
    filename,
    (label) => app.screenshot(label),
  );

  const paneQuestions = await call("/workspace/questions/read", Workspace.WorkQuestionsView, {
    kind: "document",
    recordId: occurrence.id,
  });

  expect(paneQuestions.questions[0]).toEqual(answered.question);
  expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);

  const closure = questionDialog.getByRole("form", "Markera som löst", { exact: true });

  await closure
    .getByRole("textbox", "Granskning", { exact: true })
    .fill("Reviewed both pages, retained the original occurrence and accepted the readable answer");

  const closedResponse = browser.waitForResponse(
    `**/workspace/questions/${asked.question.id}/close`,
  );

  await closure.getByRole("button", "Markera som löst", { exact: true }).focus();
  await closure.getByRole("button", "Markera som löst", { exact: true }).press("Enter");
  const closed = await decodedResponse(closedResponse, Workspace.WorkQuestionResult);

  expect(closed.question.state).toBe("closed");
  expect(closed.question.waitingOn).toBe(null);
  expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);

  const evidence = await call("/evidence", Accounting.Evidence, {
    title: "Synthetic question journey supplier setup",
    origin: "Local browser qualification",
    mediaType: "text/plain",
    content: "Synthetic supplier identity setup only",
  });

  const supplierName = `Question supplier ${suffix}`;

  const party = await call("/commerce/counterparties", Commerce.CounterpartyRevision, {
    kind: "synthetic_counterparty_v1",
    externalKey: `question_${suffix}`,
    role: "supplier",
    displayName: supplierName,
    evidenceId: evidence.id,
    reason: "Synthetic browser fixture",
  });

  await app.open(`${workspace}/purchases?view=supplier-drafts&record=inbox:${occurrence.id}`);
  const editor = await fillDraft(screen, supplierName, filename);

  const handoffResponse = browser.waitForResponse(
    `**/commerce/supplier-inbox/${occurrence.id}/review`,
  );

  await expect(editor.getByRole("button", "Spara utkast", { exact: true })).toBeEnabled();
  await editor.getByRole("button", "Spara utkast", { exact: true }).click();
  const handoff = await decodedResponse(handoffResponse, Inbox.SupplierInboxReview);

  const questions = await call("/workspace/questions/read", Workspace.WorkQuestionsView, {
    kind: "supplier",
    recordId: handoff.draft.id,
  });

  expect(handoff.draft.content.counterpartyId).toBe(party.id);
  expect(handoff.draft.totals.grossMinor).toBe("125000");
  expect(questions.root).toEqual(asked.question.root);
  expect(questions.questions[0]).toEqual(closed.question);
  expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(before);

  const sourceEvidence = await call(
    `/evidence/${handoff.draft.content.sourceEvidenceId}`,
    Accounting.EvidenceContent,
  );

  const sourceDescriptor = Schema.decodeSync(
    Schema.fromJsonString(
      Schema.Struct({
        kind: Schema.Literal("supplier_invoice_source_v1"),
        source: Schema.Struct({
          occurrenceId: Schema.String,
          sha256: Schema.String,
          filename: Schema.String,
        }),
      }),
    ),
  )(sourceEvidence.content);

  expect(sourceDescriptor.source).toEqual({
    occurrenceId: occurrence.id,
    sha256: occurrence.sha256,
    filename,
  });

  const plan = await call(
    "/commerce/supplier-acceptance-reviews",
    Acceptance.SupplierAcceptanceReview,
    {
      profile: "synthetic-manual-supplier-v1",
      draftId: handoff.draft.id,
      expectedRevision: handoff.draft.revision,
      expectedDigest: handoff.draft.digest,
      controlAccountId: "account_clearing",
      debitAccountId: "account_bank",
      accountingPeriodId: "period_synthetic_2026",
      series: "A",
      reason: `Reviewed original ${filename}`,
      acknowledgeSyntheticOnly: true,
    },
  );

  await app.open(
    `${workspace}/purchases?view=supplier-drafts&record=${handoff.draft.id}&review=${plan.id}`,
  );
  await expect(screen.getByRole("link", "Granska", { exact: true })).toBeVisible();
  await screen.getByRole("link", "Granska", { exact: true }).focus();
  await screen.getByRole("link", "Granska", { exact: true }).press("Enter");

  const canonicalPath =
    new URL(workspace).pathname +
    `/reviews/${encodeURIComponent(plan.postingPlan.id)}/${encodeURIComponent(plan.postingPlan.planDigest)}`;

  await expect.poll(async () => new URL(await browser.url()).pathname).toBe(canonicalPath);

  const resolution = await call(`/review-targets/${plan.postingPlan.id}`, Cases.ReviewResolution);

  expect(resolution).toMatchObject({
    kind: "supplier_acceptance",
    changeSetId: plan.postingPlan.id,
    planDigest: plan.postingPlan.planDigest,
    reviewId: plan.id,
    reviewDigest: plan.digest,
    draftId: handoff.draft.id,
  });
  expect(new URL(await browser.url()).searchParams.get("returnTo")).not.toBe(null);
  await expect(screen.getByRole("img", `${filename}, sida 1`)).toBeVisible();
  await expect(screen.getByRole("combobox", "Sida", { exact: true })).toHaveCount(1);
  await screen.getByRole("combobox", "Sida", { exact: true }).click();
  await screen.getByRole("option", "2 av 2", { exact: true }).click();
  await expect(screen.getByRole("img", `${filename}, sida 2`)).toBeVisible();
  await screen.getByText("Sidtext", { exact: true }).click();
  await expect(screen.getByText("Independent original page two", { exact: true })).toBeVisible();
  await screen
    .getByRole(
      "checkbox",
      "Jag förstår att detta bokför förslaget utan att fastställa momsbehandling.",
      { exact: true },
    )
    .check();

  await screen.getByRole("combobox", "Zoom", { exact: true }).click();
  await screen.getByRole("option", "125 %", { exact: true }).click();
  await expect(screen.getByRole("combobox", "Zoom", { exact: true })).toContainText("125 %");

  const desktopScreenshot = await app.screenshot(
    "document-question-focused-original-and-decision-desktop",
  );

  const nativeBrowserZoom = await nativeReviewZoom(browser, screen, filename, () =>
    app.screenshot("document-question-native-browser-zoom-probe"),
  );

  await browser.setViewport({ width: 320, height: 800 });

  const reducedMotionObserved = await browser.evaluate<boolean>(
    '() => window.matchMedia("(prefers-reduced-motion: reduce)").matches',
  );

  await expect(screen.getByRole("combobox", "Sida", { exact: true })).toContainText("2 av 2");
  await expect(screen.getByRole("combobox", "Zoom", { exact: true })).toContainText("125 %");
  await screen.getByRole("button", "Beslut", { exact: true }).focus();
  await screen.getByRole("button", "Beslut", { exact: true }).press("Enter");
  await expect(
    screen.getByRole(
      "checkbox",
      "Jag förstår att detta bokför förslaget utan att fastställa momsbehandling.",
      { exact: true },
    ),
  ).toBeChecked();
  await screen.getByRole("button", "Original", { exact: true }).focus();
  await screen.getByRole("button", "Original", { exact: true }).press("Enter");
  await expect(screen.getByRole("combobox", "Sida", { exact: true })).toContainText("2 av 2");
  await expect(screen.getByRole("combobox", "Zoom", { exact: true })).toContainText("125 %");
  await expect(screen.getByText("Independent original page two", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Beslut", { exact: true }).focus();
  await screen.getByRole("button", "Beslut", { exact: true }).press("Enter");
  await expect(
    screen.getByRole(
      "checkbox",
      "Jag förstår att detta bokför förslaget utan att fastställa momsbehandling.",
      { exact: true },
    ),
  ).toBeChecked();

  const narrowScreenshot = await app.screenshot(
    "document-question-focused-decision-320-state-retained",
  );

  await browser.setViewport({ width: 1440, height: 900 });
  await expect(screen.getByRole("img", `${filename}, sida 2`)).toBeVisible();
  await expect(screen.getByRole("combobox", "Zoom", { exact: true })).toContainText("125 %");

  const approvedResponse = browser.waitForResponse(
    `**/commerce/supplier-acceptance-reviews/${plan.id}/approvals`,
  );

  await screen.getByRole("button", "Attestera bokföring", { exact: true }).focus();
  await screen.getByRole("button", "Attestera bokföring", { exact: true }).press("Enter");
  const approval = await decodedResponse(approvedResponse, Acceptance.SupplierAcceptanceApproval);
  const executeForm = screen.getByRole("form", "Bokför och registrera", { exact: true });

  await expect(
    executeForm.getByRole("button", "Bokför och registrera", { exact: true }),
  ).toBeEnabled();
  await executeForm.getByRole("checkbox").check();

  const executionPath = `${base}/commerce/supplier-acceptance-reviews/${plan.id}/execute`;
  let committed: typeof Acceptance.SupplierAcceptanceReceipt.Type | undefined;
  let executionKey: string | undefined;

  await browser.route(executionPath, async (route) => {
    const response = await fetch(route.request.url, {
      method: route.request.method,
      headers: { ...route.request.headers, cookie, origin },
      body: route.request.postData ?? undefined,
      signal: AbortSignal.timeout(20000),
    });

    expect(response.status).toBe(200);
    committed = Schema.decodeUnknownSync(Acceptance.SupplierAcceptanceReceipt)(
      await response.json(),
    );
    executionKey = route.request.headers["idempotency-key"];
    await route.abort();
  });

  await executeForm.getByRole("button", "Bokför och registrera", { exact: true }).focus();
  await executeForm.getByRole("button", "Bokför och registrera", { exact: true }).press("Enter");
  await expect.poll(() => committed?.reviewId).toBe(plan.id);
  await browser.unroute(executionPath);

  if (!committed || !executionKey)
    throw new Error("The real owner must commit before response loss");
  const receipt = committed;
  const afterLostResponse = await call("/ledger", Accounting.LedgerSnapshot);

  await browser.reload();
  await expect(screen.getByRole("status").filter({ hasText: "Bokförd" })).toBeVisible();
  await expect(screen.getByRole("button", "Bokför och registrera", { exact: true })).toHaveCount(0);

  const recoveryScreenshot = await app.screenshot(
    "document-question-lost-response-reloaded-receipt",
  );

  const posted = await call(
    `/commerce/supplier-acceptance-reviews/${plan.id}`,
    Acceptance.SupplierAcceptanceView,
  );

  const afterPosting = await call("/ledger", Accounting.LedgerSnapshot);

  expect(receipt.approvalId).toBe(approval.id);
  expect(receipt.draftDigest).toBe(handoff.draft.digest);
  expect(posted.plan.draftSnapshot.sourceEvidence.evidenceId).toBe(sourceEvidence.id);
  expect(posted.acceptance).toEqual(receipt);
  expect(BigInt(afterPosting.sequence) - BigInt(before.sequence)).toBe(1n);
  expect(afterPosting).toEqual(afterLostResponse);
  expect(
    afterPosting.accounts.map(({ accountId, debitMinor, creditMinor, balanceMinor }) => ({
      accountId,
      debitMinor,
      creditMinor,
      balanceMinor,
    })),
  ).toEqual([
    { accountId: "account_bank", debitMinor: "125000", creditMinor: "0", balanceMinor: "125000" },
    {
      accountId: "account_clearing",
      debitMinor: "0",
      creditMinor: "125000",
      balanceMinor: "-125000",
    },
  ]);

  const completed = await call("/workspace/questions/read", Workspace.WorkQuestionsView, {
    kind: "supplier",
    recordId: handoff.draft.id,
  });

  expect(completed.owner.completed).toBe(true);
  expect(completed.questions[0]).toEqual(closed.question);
  const postingScreenshot = await app.screenshot("document-question-frozen-original-posted");

  const statementSource = {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: `question_${suffix}`,
    sourceBankAccountId: "synthetic_bank",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-10-01",
    endsOn: "2026-10-31",
    openingMinor: "0",
    closingMinor: "125000",
    completeness: { declaredComplete: false, basis: "Synthetic single-row allocation fixture" },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2026-10-03",
        description: filename,
        amountMinor: "125000",
      },
    ],
  };

  const statementEvidence = await call("/evidence", Accounting.Evidence, {
    title: `Bank return ${filename}`,
    origin: "Synthetic browser allocation fixture",
    mediaType: "application/json",
    content: JSON.stringify(statementSource),
  });

  const statement = await call("/bank-statements", Bank.StatementImportReceipt, {
    ...statementSource,
    evidenceId: statementEvidence.id,
    existingMatches: [],
  });

  const candidates = await call("/bank-match-candidates", Candidates.BankMatchCandidates, {
    statementId: statement.statement.id,
    rowOrdinal: 1,
  });

  const retainedStatement = await call(
    `/bank-statements/${statement.statement.id}`,
    Bank.BankStatementView,
  );

  const retainedStatementEvidence = await call(
    `/evidence/${statementEvidence.id}`,
    Accounting.EvidenceContent,
  );

  expect(retainedStatement.statement).toEqual(statement.statement);
  expect(retainedStatement.statement.rows).toEqual(statementSource.rows);
  expect(candidates.source).toMatchObject({
    statementId: retainedStatement.statement.id,
    rowOrdinal: 1,
    evidenceId: retainedStatementEvidence.id,
    evidenceSha256: retainedStatementEvidence.sha256,
    observedOn: statementSource.rows[0]?.date,
    description: statementSource.rows[0]?.description,
    amountMinor: statementSource.rows[0]?.amountMinor,
    allocatedMinor: "0",
    remainingMinor: "125000",
  });
  expect(retainedStatementEvidence.content).toBe(JSON.stringify(statementSource));

  const candidate = candidates.candidates.find(
    (item) => item.voucherId === receipt.postingReceipt.voucherId && item.eligible,
  );

  if (!candidate)
    throw new Error("The actual posted bank line must be eligible for the retained statement row");

  await app.open(
    `${workspace}/accounts?account=account_bank&from=2026-10-01&to=2026-10-31&statement=${statement.statement.id}&row=1`,
  );
  const matching = screen.getByRole("dialog", "Matcha transaktion", { exact: true });

  await expect(matching.getByRole("heading", filename, { exact: true })).toBeVisible();
  await expect(browser.locator(`div:has(> h2:text-is("${filename}")) > p`)).toHaveText(
    candidates.source.observedOn,
  );
  await expect(browser.locator('div:has(> span:text-is("Banktransaktion"))')).toContainText(
    "1 250,00 SEK",
  );
  await matching.getByText("Visa kontoutdragets underlag", { exact: true }).click();
  await matching.getByRole("button", "Granska sparat underlag", { exact: true }).click();
  await expect(
    matching.getByRole("textbox", "Underlagstext eller förklaring", { exact: true }),
  ).toHaveValue(retainedStatementEvidence.content);
  await matching.getByText("Uppgifter om underlaget", { exact: true }).click();
  await expect(
    matching.getByText(`${retainedStatementEvidence.id}, ${retainedStatement.statement.id}/1`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    matching.getByText(`SHA-256: ${retainedStatementEvidence.sha256}`, { exact: true }),
  ).toBeVisible();

  const bankEvidenceScreenshot = await app.screenshot(
    "document-question-retained-bank-row-evidence",
  );

  const sourceLink = matching.getByRole("link", "Importerat kontoutdrag", { exact: true });

  const sourceHref = await sourceLink.getAttribute("href");

  if (!sourceHref)
    throw new Error("The retained bank row must link to its actual source statement");

  const sourceDestination = new URL(sourceHref, origin);

  expect(sourceDestination.pathname).toBe(new URL(workspace).pathname + "/accounts");
  expect(sourceDestination.searchParams.get("record")).toBe(
    `statement:${retainedStatement.statement.id}`,
  );
  expect(sourceDestination.searchParams.get("view")).toBe("bank");

  const sourceResponse = browser.waitForResponse(
    `**/bank-statements/${retainedStatement.statement.id}`,
  );

  await sourceLink.focus();
  await sourceLink.press("Enter");

  const inspectedStatement = await decodedResponse(sourceResponse, Bank.BankStatementView);

  expect(inspectedStatement.statement).toEqual(retainedStatement.statement);
  await expect(
    screen.getByRole("heading", "Importerat kontoutdrag", { exact: true }),
  ).toBeVisible();
  await screen.getByText("Underlag och referenser", { exact: true }).click();
  await expect(
    screen.getByText(
      `Kontoutdragets ID: ${retainedStatement.statement.id}, ${retainedStatement.statement.statementIdentifier}`,
      { exact: true },
    ),
  ).toBeVisible();

  const statementScreenshot = await app.screenshot("document-question-bank-source-statement");

  await screen.getByRole("link", "Tillbaka till arbetet", { exact: true }).focus();
  await screen.getByRole("link", "Tillbaka till arbetet", { exact: true }).press("Enter");

  const returnedBank = new URL(await browser.url());

  expect(returnedBank.searchParams.get("statement")).toBe(retainedStatement.statement.id);
  expect(returnedBank.searchParams.get("row")).toBe("1");
  expect(returnedBank.searchParams.get("account")).toBe("account_bank");
  expect(returnedBank.searchParams.get("from")).toBe("2026-10-01");
  expect(returnedBank.searchParams.get("to")).toBe("2026-10-31");
  expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(afterPosting);

  await expect(matching.getByRole("row").filter({ hasText: candidate.description })).toBeVisible();
  await matching
    .getByRole("row")
    .filter({ hasText: candidate.description })
    .getByRole("button", "Välj", { exact: true })
    .click();
  const matchingForm = matching.getByRole("form", "Förbered matchning", { exact: true });

  await matchingForm
    .getByLabel("Varför hör transaktionerna ihop?", { exact: true })
    .fill("The same reviewed original produced this retained posted bank line");
  await matchingForm
    .getByRole("checkbox", "Jag har jämfört transaktionerna och kontrollerat underlaget.", {
      exact: true,
    })
    .check();
  const matchPlanResponse = browser.waitForResponse("**/bank-allocation-plans");

  await matchingForm.getByRole("button", "Förbered matchning", { exact: true }).click();
  const matchPlan = await decodedResponse(matchPlanResponse, Settlement.BankAllocationPlan);

  await expect(matching.getByRole("link", "Importerat kontoutdrag", { exact: true })).toBeVisible();

  await matching
    .getByRole("checkbox", "Jag har granskat beloppen och kontoutdragets underlag.", {
      exact: true,
    })
    .check();

  const matchApprovalResponse = browser.waitForResponse(
    `**/bank-allocation-plans/${matchPlan.id}/approve`,
  );

  await matching.getByRole("button", "Godkänn matchning", { exact: true }).click();
  await decodedResponse(matchApprovalResponse, Settlement.BankAllocationApproval);

  const matchedResponse = browser.waitForResponse(
    `**/bank-allocation-plans/${matchPlan.id}/execute`,
  );

  await matching.getByRole("button", "Bekräfta matchning", { exact: true }).focus();
  await matching.getByRole("button", "Bekräfta matchning", { exact: true }).press("Enter");
  const matched = await decodedResponse(matchedResponse, Settlement.BankAllocationExecution);

  expect(matched.legs).toHaveLength(1);
  expect(matched.legs[0]).toMatchObject({
    statementId: statement.statement.id,
    rowOrdinal: 1,
    voucherId: receipt.postingReceipt.voucherId,
    lineId: candidate.lineId,
    amountMinor: "125000",
  });
  expect(await call("/ledger", Accounting.LedgerSnapshot)).toEqual(afterPosting);
  const bankScreenshot = await app.screenshot("document-question-posted-bank-line-allocated");

  await writeFile(
    join(output, "document-question-posting.json"),
    JSON.stringify(
      {
        syntheticOnly: true,
        browserActorCount: 1,
        setup:
          "Public synthetic supplier identity and native synthetic-manual review preparation; upload, draft handoff, questions, closure, approval, posting and bank allocation use actual UI commands",
        occurrence,
        malformed,
        readable,
        answeredQuestion: answered.question,
        questionPane: { ...questionPane, view: paneQuestions, operator },
        question: closed.question,
        rootAfterDraft: questions.root,
        handoff,
        sourceDescriptor,
        plan,
        resolution,
        canonicalPath,
        responsiveReview: {
          width: 320,
          page: 2,
          zoomPercent: 125,
          checkboxRetained: true,
          reducedMotionObserved,
          nativeBrowserZoom,
        },
        approval,
        receipt,
        recovery: { executionKey, committed, afterLostResponse, reloaded: true },
        completed,
        statement,
        retainedStatement,
        inspectedStatement,
        bankSource: candidates.source,
        retainedStatementEvidence,
        matched,
        before,
        afterPosting,
        afterMatching: await call("/ledger", Accounting.LedgerSnapshot),
        screenshots: [
          missingScreenshot,
          questionPane.desktopScreenshot,
          questionPane.attachmentScreenshot,
          questionPane.narrowScreenshot,
          desktopScreenshot,
          narrowScreenshot,
          postingScreenshot,
          recoveryScreenshot,
          bankEvidenceScreenshot,
          statementScreenshot,
          bankScreenshot,
        ],
        remaining:
          "This single journey does not qualify the complete P03/P04 requirements, P12 parity or multi-operator browser handoff; native 200% browser zoom is qualified only when nativeBrowserZoom.qualified is true and reduced-motion acceptance requires the retained actual media observation to be true",
      },
      null,
      2,
    ),
  );
});
