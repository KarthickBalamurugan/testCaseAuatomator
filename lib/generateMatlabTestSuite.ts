import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Free-tier model. This is viable now because generation is chunked: each
// call only has to produce ~15-30 lines of test logic for ONE test case,
// not a ~500-line self-consistent script. Everything else (config, local
// functions, meta descriptions, the report generator) is static or built
// deterministically from the parsed spreadsheet data below — the model
// never touches it, so it can't drift or hallucinate it.
const MODEL = "gemini-3.5-flash-lite";

export interface TestCaseInput {
  id: string;
  title?: string;
  objective?: string;
  criteria?: string; // Pass/Fail criteria text
}

export interface GenerateTestCasesInput {
  modelName: string;
  requirementId: string; // e.g. "REQ-IB_BHMS-SC-PSB-005"
  requirementDescription?: string; // legacy: "TC-ID - Title: Objective (Pass/Fail: Criteria)" lines
  testCases?: TestCaseInput[]; // preferred: structured rows straight from the parsed workbook
  ports: string[]; // exact Simulink root inport names
  count?: number; // optional sanity check only, not used to derive IDs anymore
}

interface ParsedTestCase {
  id: string;
  title: string;
  objective: string;
  criteria: string;
}

/** Pulls the trailing "<LETTERS>-<NUMBERS>" chunk out of a requirement ID,
 *  e.g. "REQ-IB_BHMS-SC-PSB-005" -> "PSB-005". */
function extractReqSuffix(requirementId: string): string {
  const match = requirementId.match(/([A-Z]+-\d+)\s*$/i);
  if (match) return match[1].toUpperCase();
  return requirementId.replace(/[^A-Za-z0-9]+/g, "-").toUpperCase();
}

function normalizeTestCase(tc: TestCaseInput): ParsedTestCase {
  return {
    id: tc.id,
    title: tc.title ?? tc.id,
    objective: tc.objective ?? "",
    criteria: tc.criteria ?? "",
  };
}

/** Parses the legacy joined-line format produced by page.tsx:
 *    "TC-ID - Title: Objective (Pass/Fail: Criteria)"
 *  Record boundaries are found by scanning for lines that START a record
 *  (rather than naively splitting on "\n"), because Excel cells for
 *  Objective/Criteria often contain embedded line breaks (see the wrapped
 *  "Pass/Fail Criteria" column in the source workbook) which would
 *  otherwise chop one test case across several "lines". */
function parseTestCasesFromDescription(desc: string): ParsedTestCase[] {
  const raw = desc.replace(/\r\n/g, "\n");
  const recordStartRe = /^TC-\S+\s*-\s*/gm;

  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = recordStartRe.exec(raw)) !== null) starts.push(m.index);
  if (starts.length === 0) return [];
  starts.push(raw.length);

  const cases: ParsedTestCase[] = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const record = raw.slice(starts[i], starts[i + 1]).trim();
    const parsed = parseOneRecord(record);
    if (parsed) cases.push(parsed);
  }
  return cases;
}

function parseOneRecord(record: string): ParsedTestCase | null {
  const critMatch = record.match(/\(Pass\/Fail:\s*([\s\S]*)\)\s*$/);
  if (!critMatch || critMatch.index === undefined) return null;
  const criteria = critMatch[1].replace(/\s+/g, " ").trim();

  const head = record.slice(0, critMatch.index).trim();
  const idSplit = head.indexOf(" - ");
  if (idSplit === -1) return null;

  const id = head.slice(0, idSplit).trim();
  if (!id.toUpperCase().startsWith("TC-")) return null;

  const rest = head.slice(idSplit + 3).trim();
  const titleSplit = rest.indexOf(": ");
  const title = (titleSplit === -1 ? rest : rest.slice(0, titleSplit)).replace(/\s+/g, " ").trim();
  const objective = (titleSplit === -1 ? "" : rest.slice(titleSplit + 2)).replace(/\s+/g, " ").trim();

  return { id, title, objective, criteria };
}

/** meta('TC-...') = struct(...) line — built directly from parsed data, no LLM involved. */
function buildMetaLine(tc: ParsedTestCase, ports: string[]): string {
  const esc = (s: string) => s.replace(/'/g, "''");
  return `meta('${tc.id}') = struct('Title','${esc(tc.title)}','Objective','${esc(tc.objective)}','Input','${esc(
    ports.join(", ")
  )}','Criterion','${esc(tc.criteria)}');`;
}

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:matlab)?\s*\n/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/** One small, focused prompt per test case — this is the only part of the
 *  script the model actually writes. */
function buildBlockPrompt(tc: ParsedTestCase, ports: string[]): string {
  const portsList = ports.map((p) => `'${p}'`).join(", ");
  return `Write ONE executable MATLAB code block for a Simulink verification test.
Output ONLY MATLAB code. No markdown fences, no explanation, no function definitions, no other test cases.

Fixed values (copy exactly, never rename or invent alternatives):
  Model variable: mdl        (already holds the model name)
  Sample time variable: ts   (already defined, in seconds)
  Test Case ID string: '${tc.id}'
  Root inport names, in this order: ${portsList }

From the requirement document:
  Title: ${tc.title}
  Objective: ${tc.objective}
  Pass/Fail Criteria: ${tc.criteria}

The block must:
1. Build tVec = (0:ts:DURATION)' choosing a DURATION (seconds) that suits the objective (usually 1-10).
2. Build one input signal per port listed above, in that order, that plausibly exercises the Objective
   (sine/step/ramp for a numeric pressure-like port; ones()/zeros() for boolean flag ports — toggle a
   flag mid-run if the objective calls for it, e.g. "reset on invalidation" or "power-up").
3. Call exactly: [t, y] = runModelSimulation(mdl, tVec, {sig1, sig2, ...}, {${portsList}});
4. Compute ONE real numeric metric from y that checks the Pass/Fail Criteria above — never hardcode
   Measured to 0. Pick whichever technique fits: FFT gain/attenuation at a target Hz, settling time,
   coefficient of variation, mean/steady-state error, % change after a flag toggles, max(abs()) boundary
   check, or isnan/isinf robustness check.
5. Decide isPass by comparing the metric to a numeric expected value and tolerance drawn from the Criteria.
6. Append exactly one row:
   results = [results; {"${tc.id}", "<short metric name>", measured, expected, tolerance, ternary(isPass,"PASS","FAIL"), "<short note>"}];
7. End with (reuse the same signal/port cell arrays from step 3):
   saveData(t, {sig1, sig2, ...}, {${portsList}}, y, '${tc.id}', dataDir);
   plotTestCase(t, {sig1, sig2, ...}, {${portsList}}, y, '${tc.id}', '${tc.title.replace(/'/g, "''")}', plotsDir);
8. Start with: fprintf('Running ${tc.id}...\\n');
9. Only use "PENDING" instead of a real PASS/FAIL if the Objective explicitly says this test case is a
   placeholder, manual, or future item.`;
}

function validateBlock(block: string, tc: ParsedTestCase, ports: string[]): string[] {
  const problems: string[] = [];
  if (!block.includes(tc.id)) problems.push("missing test case ID");
  if (!/results\s*=\s*\[results;/.test(block)) problems.push("missing results row");
  if (!block.includes("runModelSimulation(")) problems.push("missing runModelSimulation call");
  if (!block.includes("saveData(")) problems.push("missing saveData call");
  if (!block.includes("plotTestCase(")) problems.push("missing plotTestCase call");
  for (const p of ports) {
    if (!block.includes(p)) problems.push(`missing port '${p}'`);
  }
  return problems;
}

/** Deterministic, always-valid block used if the model fails validation twice.
 *  Guarantees the script never breaks for one bad test case — that test case
 *  just gets a generic finite-output check flagged for manual review. */
function fallbackBlock(tc: ParsedTestCase, ports: string[]): string {
  const sigVars = ports.map((_, i) => `sig${i + 1}`);
  const sigLines = ports
    .map((_, i) => (i === 0 ? `sig${i + 1} = 50*sin(2*pi*1*tVec);` : `sig${i + 1} = ones(size(tVec));`))
    .join("\n");
  const sigCell = `{${sigVars.join(", ")}}`;
  const portCell = `{${ports.map((p) => `'${p}'`).join(", ")}}`;
  const titleEsc = tc.title.replace(/'/g, "''");

  return [
    `fprintf('Running ${tc.id}...\\n');`,
    `tVec = (0:ts:5)';`,
    sigLines,
    `[t, y] = runModelSimulation(mdl, tVec, ${sigCell}, ${portCell});`,
    `measured = double(~any(isnan(y)) && ~any(isinf(y)));`,
    `expected = 1; tol = 0;`,
    `isPass = measured == expected;`,
    `results = [results; {"${tc.id}", "Output finite (auto-fallback, needs manual review)", measured, expected, tol, ternary(isPass,"PASS","FAIL"), "Model generation failed validation - implement manually"}];`,
    `saveData(t, ${sigCell}, ${portCell}, y, '${tc.id}', dataDir);`,
    `plotTestCase(t, ${sigCell}, ${portCell}, y, '${tc.id}', '${titleEsc}', plotsDir);`,
  ].join("\n");
}

async function generateBlockWithRetries(
  tc: ParsedTestCase,
  ports: string[],
  maxAttempts = 2
): Promise<string> {
  let lastProblems: string[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const prompt =
        buildBlockPrompt(tc, ports) +
        (lastProblems.length
          ? `\n\nYour previous attempt was invalid (${lastProblems.join(
              "; "
            )}). Fix this and output only the corrected block.`
          : "");

      const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { temperature: 0.15, maxOutputTokens: 700 },
      });

      const block = stripMarkdownFences(response.text ?? "");
      const problems = validateBlock(block, tc, ports);
      if (problems.length === 0) return block;
      lastProblems = problems;
    } catch (err) {
      lastProblems = [err instanceof Error ? err.message : String(err)];
    }
  }

  console.warn(`generateMatlabTestSuite: falling back for ${tc.id} (${lastProblems.join("; ")})`);
  return fallbackBlock(tc, ports);
}

function buildHeader(
  mdl: string,
  requirementId: string,
  reportFile: string,
  csvFile: string,
  idsLiteral: string,
  metaLines: string
): string {
  return `%% MBD_TestSuite.m
% Automated test runner for MBD Verification
% Model: ${mdl}
% Requirement ID: ${requirementId}
% Auto-generated - review before use in a qualification run.

clear; clc; close all;

%% ============ CONFIG ============
mdl        = '${mdl}';
ts         = 0.005;                    % 200 Hz sample time
dataDir    = 'test_data';
plotsDir   = 'test_plots';
reportFile = '${reportFile}';
csvFile    = '${csvFile}';

load_system(mdl);

results = table('Size',[0 7], ...
    'VariableTypes',{'string','string','double','double','double','string','string'}, ...
    'VariableNames',{'TestCaseID','Metric','Measured','Expected','Tolerance','Result','Notes'});

ids = {${idsLiteral}};

meta = containers.Map();
${metaLines}

%% ============ TEST CASES EXECUTION ============`;
}

function buildFooter(reportFile: string, requirementId: string): string {
  return `%% ============ GENERATE REPORTS ============
fprintf('\\n=== SUMMARY ===\\n');
nPass = sum(results.Result == "PASS");
nFail = sum(results.Result == "FAIL");
nPending = sum(results.Result == "PENDING");
nTotal = height(results);
fprintf('%d/%d tests PASS | %d FAIL | %d PENDING (out of %d metrics)\\n', nPass, max(nTotal-nPending,1), nFail, nPending, nTotal);

fprintf('\\nExporting to CSV: %s\\n', csvFile);
writetable(results, csvFile);

fprintf('Generating Word (.docx) report: %s\\n', reportFile);
generateWordReport(results, meta, ids, reportFile);

fprintf('\\nAll test data saved to: %s\\\\\\n', dataDir);
fprintf('Scope plots saved as PNGs under: %s\\\\\\n', plotsDir);
fprintf('\\nTest suite complete.\\n');


%% ===================== LOCAL FUNCTIONS (static — never model-generated) =====================

function [t, y] = runModelSimulation(mdl, tVec, inputs, portNames)
    ds = Simulink.SimulationData.Dataset;
    for k = 1:numel(portNames)
        tsData = timeseries(inputs{k}, tVec);
        tsData.Name = portNames{k};
        ds = ds.addElement(tsData, portNames{k});
    end
    in = Simulink.SimulationInput(mdl);
    in = in.setExternalInput(ds);
    in = in.setModelParameter('StopTime', num2str(tVec(end)));
    out = sim(in, 'ShowProgress', 'off');
    t = out.tout;
    y = getSignal(out);
end

function y = getSignal(out)
    if isprop(out, 'simout') || isfield(out, 'simout')
        s = out.simout;
        if isa(s, 'timeseries')
            y = s.Data;
        elseif isstruct(s) && isfield(s, 'signals')
            y = s.signals.values;
        else
            y = s;
        end
    elseif ~isempty(out.who('logsout'))
        y = out.logsout.getElement(1).Values.Data;
    else
        error('Could not locate output signal in SimulationOutput.');
    end
    y = y(:);
end

function out = ternary(cond, a, b)
    if cond, out = a; else, out = b; end
end

function saveData(tVec, inputs, portNames, y, name, dataDir)
    if ~exist(dataDir, 'dir'), mkdir(dataDir); end
    varNames = {'Time_s'};
    cols = {tVec(:)};
    for k = 1:numel(inputs)
        cols{end+1} = inputs{k}(:); %#ok<AGROW>
        safeName = matlab.lang.makeValidName(portNames{k});
        varNames{end+1} = safeName; %#ok<AGROW>
    end
    cols{end+1} = y(:);
    varNames{end+1} = 'Output';
    T = table(cols{:}, 'VariableNames', varNames);
    writetable(T, fullfile(dataDir, [name '.csv']));
end

function fig = plotTestCase(t, inputs, portNames, y, tcID, titleStr, plotsDir)
    fig = figure('Visible','on','Name',sprintf('%s: %s', tcID, titleStr),'Position',[100 100 900 600]);
    subplot(2,1,1);
    hold on;
    colors = lines(numel(inputs));
    legendEntries = {};
    for k = 1:numel(inputs)
        plot(t, inputs{k}, 'Color', colors(k,:), 'LineWidth', 1.2);
        legendEntries{end+1} = portNames{k}; %#ok<AGROW>
    end
    legend(legendEntries, 'Interpreter', 'none', 'Location', 'best');
    ylabel('Input Signals');
    title(sprintf('%s: %s - Input Signals', tcID, titleStr)); grid on;

    subplot(2,1,2);
    plot(t, y, 'r-', 'LineWidth',1.2);
    xlabel('Time [s]'); ylabel('Output Signal');
    title('Measured Response'); grid on;

    savePlot(fig, ['TestPlot_' strrep(tcID,'-','_')], plotsDir);
end

function relPath = savePlot(fig, name, plotsDir)
    if ~exist(plotsDir,'dir'), mkdir(plotsDir); end
    relPath = fullfile(plotsDir, [name '.png']);
    exportgraphics(fig, relPath, 'Resolution', 150);
end

function generateWordReport(results, meta, ids, reportFile)
    import mlreportgen.dom.*
    [~, baseName] = fileparts(reportFile);
    d = Document(baseName, 'docx');

    titlePara = Paragraph('MBD Verification Test Report');
    titlePara.Style = {Bold(true), FontSize('18pt'), Color('#1A3C6E')};
    append(d, titlePara);

    subPara = Paragraph(sprintf('${requirementId}: %s through %s', ids{1}, ids{end}));
    subPara.Style = {FontSize('12pt'), Color('#444444')};
    append(d, subPara);

    metaLines = {
        sprintf('Generated: %s', datestr(now))
        sprintf('MATLAB: %s', version)
        sprintf('Tester: ______________    SW Version: ______________')
    };
    for i = 1:numel(metaLines)
        p = Paragraph(metaLines{i});
        p.Style = {FontSize('10pt')};
        append(d, p);
    end
    append(d, Paragraph(' '));

    nPass    = sum(results.Result == "PASS");
    nFail    = sum(results.Result == "FAIL");
    nPending = sum(results.Result == "PENDING");
    nTotal   = height(results);
    denom    = max(nTotal - nPending, 1);

    h = Paragraph('Executive Summary');
    h.Style = {Bold(true), FontSize('14pt'), Color('#1A3C6E')};
    append(d, h);

    summaryLines = {
        sprintf('Total Metrics: %d', nTotal)
        sprintf('Passed: %d (%.1f%%)', nPass, 100*nPass/denom)
        sprintf('Failed: %d', nFail)
        sprintf('Pending: %d', nPending)
    };
    for i = 1:numel(summaryLines)
        append(d, Paragraph(summaryLines{i}));
    end
    append(d, Paragraph(' '));
    append(d, PageBreak());

    for i = 1:numel(ids)
        id = ids{i};
        if ~isKey(meta, id), continue; end
        m = meta(id);

        h2 = Paragraph(sprintf('%s: %s', id, m.Title));
        h2.Style = {Bold(true), FontSize('14pt'), Color('#1A3C6E')};
        append(d, h2);

        infoLines = {
            sprintf('Objective: %s', m.Objective)
            sprintf('Input: %s', m.Input)
            sprintf('Pass Criterion: %s', m.Criterion)
        };
        for k = 1:numel(infoLines)
            append(d, Paragraph(infoLines{k}));
        end
        append(d, Paragraph(' '));

        rows = results(results.TestCaseID == id, :);
        if height(rows) == 0
            noteP = Paragraph('No automated check implemented for this test case (pending).');
            noteP.Style = {Italic(true), Color('#888888')};
            append(d, noteP);
        else
            headerRow = {'Metric','Measured','Expected','Tolerance','Result','Notes'};
            tableData = cell(height(rows)+1, 6);
            tableData(1,:) = headerRow;
            for r = 1:height(rows)
                tableData{r+1,1} = char(rows.Metric(r));
                tableData{r+1,2} = sprintf('%.4f', rows.Measured(r));
                tableData{r+1,3} = sprintf('%.4f', rows.Expected(r));
                tableData{r+1,4} = sprintf('%.4f', rows.Tolerance(r));
                tableData{r+1,5} = char(rows.Result(r));
                tableData{r+1,6} = char(rows.Notes(r));
            end

            tbl = Table(tableData);
            tbl.Style = {Border('single'), ColSep('single'), RowSep('single'), Width('100%')};
            headerRowObj = tbl.Children(1);
            headerRowObj.Style = {Bold(true), BackgroundColor('#1A3C6E'), Color('#FFFFFF')};

            for r = 1:height(rows)
                resStr = char(rows.Result(r));
                rowObj = tbl.Children(r+1);
                resultCell = rowObj.Children(5);
                if strcmp(resStr,'PASS')
                    resultCell.Style = {Bold(true), Color('#0A7A0A')};
                elseif strcmp(resStr,'FAIL')
                    resultCell.Style = {Bold(true), Color('#CC0000')};
                else
                    resultCell.Style = {Italic(true), Color('#888888')};
                end
            end
            append(d, tbl);
        end
        append(d, Paragraph(' '));
        append(d, PageBreak());
    end

    footerPara = Paragraph('Auto-generated engineering test report. Scope plots are saved as PNG files.');
    footerPara.Style = {FontSize('9pt'), Italic(true), Color('#888888')};
    append(d, footerPara);

    close(d);
    fprintf('DOCX report generated successfully: %s\\n', reportFile);
end
`;
}

function validateFullScript(code: string, ids: string[], reportFile: string, csvFile: string): void {
  const problems: string[] = [];
  for (const id of ids) {
    if (!code.includes(id)) problems.push(`Missing test case ID '${id}' in assembled script.`);
  }
  if (!code.includes(reportFile)) problems.push(`Missing report file reference '${reportFile}'.`);
  if (!code.includes(csvFile)) problems.push(`Missing csv file reference '${csvFile}'.`);
  if (!code.includes("function generateWordReport")) problems.push("generateWordReport function is missing.");

  if (problems.length > 0) {
    throw new Error("Assembled MATLAB script failed validation:\n" + problems.map((p) => `- ${p}`).join("\n"));
  }
}

export async function generateMatlabTestSuite(input: GenerateTestCasesInput): Promise<string> {
  const { modelName, requirementId, requirementDescription, testCases, ports } = input;

  if (!ports || ports.length === 0) {
    throw new Error(
      "generateMatlabTestSuite: 'ports' is required — pass the exact Simulink root inport names (from the Property Inspector)."
    );
  }

  const cases: ParsedTestCase[] = testCases?.length
    ? testCases.map(normalizeTestCase)
    : parseTestCasesFromDescription(requirementDescription ?? "");

  if (cases.length === 0) {
    throw new Error(
      "generateMatlabTestSuite: found no test cases. Pass structured 'testCases', or a 'requirementDescription' " +
        "made of lines like 'TC-ID - Title: Objective (Pass/Fail: Criteria)'."
    );
  }

  if (input.count && input.count !== cases.length) {
    console.warn(
      `generateMatlabTestSuite: 'count' (${input.count}) does not match the ${cases.length} test case(s) found; ` +
        `proceeding with the ${cases.length} that were actually parsed.`
    );
  }

  const reqSuffix = extractReqSuffix(requirementId);
  const reqSuffixCompact = reqSuffix.replace(/-/g, "");
  const reportFile = `${reqSuffixCompact}_TestResults.docx`;
  const csvFile = `${reqSuffixCompact}_TestResults.csv`;
  const ids = cases.map((c) => c.id);
  const idsLiteral = ids.map((id) => `'${id}'`).join(", ");

  // Deterministic — no LLM involved, so it can't drift from the spreadsheet.
  const metaLines = cases.map((tc) => buildMetaLine(tc, ports)).join("\n");

  // Model-generated — one small, focused call per test case.
  const blocks: string[] = [];
  for (const tc of cases) {
    const block = await generateBlockWithRetries(tc, ports);
    blocks.push(`%% ${tc.id}: ${tc.title}\n${block}`);
  }

  const script = [
    buildHeader(modelName, requirementId, reportFile, csvFile, idsLiteral, metaLines),
    blocks.join("\n\n"),
    buildFooter(reportFile, requirementId),
  ].join("\n\n");

  validateFullScript(script, ids, reportFile, csvFile);
  return script;
}