import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
// NOTE: flash-lite is a weak choice for generating ~500 lines of precise,
// self-consistent MATLAB with per-test-case numeric logic. If quality is
// still inconsistent after these prompt fixes, switch to a stronger model
// (e.g. gemini-2.5-pro / gemini-3-pro) for this call specifically.
const MODEL = "gemini-3.5-flash-lite";

export interface GenerateTestCasesInput {
  modelName: string;
  requirementId: string; // e.g. "REQ-IB_BHMS-SC-PSB-005"
  requirementDescription: string;
  ports: string[]; // exact Simulink root inport names, e.g. ["PRawFastFlt","lbBhms.PressValid","lbBhms.SysInit"]
  count?: number;
}

/** Pulls the trailing "<LETTERS>-<NUMBERS>" chunk out of a requirement ID,
 *  e.g. "REQ-IB_BHMS-SC-PSB-005" -> "PSB-005".
 *  Falls back to a slugified version of the whole ID if no match is found. */
function extractReqSuffix(requirementId: string): string {
  const match = requirementId.match(/([A-Z]+-\d+)\s*$/i);
  if (match) return match[1].toUpperCase();
  return requirementId.replace(/[^A-Za-z0-9]+/g, "-").toUpperCase();
}

function buildTestCaseIds(reqSuffix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    `TC-${reqSuffix}-${String(i + 1).padStart(2, "0")}`
  );
}

export async function generateMatlabTestSuite(
  input: GenerateTestCasesInput
): Promise<string> {
  const { modelName, requirementId, requirementDescription, ports, count = 5 } = input;

  if (!ports || ports.length === 0) {
    throw new Error(
      "generateMatlabTestSuite: 'ports' is required — the model must not invent " +
        "root inport names. Pass the exact Simulink port names (e.g. from the " +
        "Property Inspector)."
    );
  }

  const reqSuffix = extractReqSuffix(requirementId); // e.g. "PSB-005"
  const reqSuffixCompact = reqSuffix.replace(/-/g, ""); // "PSB005"
  const testIds = buildTestCaseIds(reqSuffix, count); // ["TC-PSB-005-01", ...]
  const reportFile = `${reqSuffixCompact}_TestResults.docx`;
  const csvFile = `${reqSuffixCompact}_TestResults.csv`;

  const portsBlock = ports
    .map((p, i) => `   Port ${i + 1} -> '${p}'`)
    .join("\n");

  const idsLiteral = testIds.map((id) => `'${id}'`).join(", ");

  const prompt = `You are an expert Model-Based Development (MBD) test engineer writing a
production MATLAB verification test script (Simulink Test / mlreportgen style).

=== FIXED, NON-NEGOTIABLE VALUES (do not change, invent, or rename any of these) ===
Model Name: ${modelName}
Requirement ID: ${requirementId}
Test Case IDs (use exactly these, in this exact order, no more, no fewer): ${idsLiteral}
Report file name: ${reportFile}
CSV file name: ${csvFile}
Root Inport names (use these EXACT strings, verbatim, case-sensitive, wherever a
port name string is needed — do NOT shorten, rename, or invent alternative names):
${portsBlock}

=== REQUIREMENT TEXT TO IMPLEMENT ===
${requirementDescription}

=== HARD RULES ===
1. Every one of the ${count} test cases listed above MUST get its own executable
   MATLAB block that:
   a. Builds distinct input timeseries for EACH of the ports listed above
      (not just the first one) using the exact port name strings given.
   b. Calls the model via runModelSimulation(mdl, tVec, {inputs...}, {portNames...}).
   c. Computes at least one REAL numeric metric relevant to that test's objective
      and compares it to a numeric threshold to decide PASS/FAIL. Choose the
      technique that fits the objective, for example:
        - Frequency-domain: FFT gain/attenuation at a target frequency
        - Time-domain: settling time, overshoot, coefficient of variation,
          mean/steady-state error, rise/fall time
        - Robustness: NaN/Inf checks, saturation/boundary checks
        - Reset/invalidation: % reduction in output magnitude after a flag toggles
   d. Appends a row (or rows) to 'results' with a real Measured value (never a
      hardcoded 0) and a Result of "PASS" or "FAIL" computed from real logic.
   e. Calls saveData(...) and plotTestCase(...) (see signatures below).
2. Do NOT use "PENDING" for any test case unless the requirement text explicitly
   says that test case is a placeholder / future / manual-only verification item.
   If you are tempted to write "PENDING", instead pick the closest applicable
   metric from rule 1c and implement it.
3. Do not add, remove, rename, or reorder any test case ID. Do not invent new
   requirement or port names anywhere in the script.
4. The signal design for each test case must plausibly match its stated
   objective (e.g. a "reset on invalidation" test must actually toggle the
   validity port mid-run; a "boundary input" test must actually drive the
   signal to its documented min/max).

=== WORKED EXAMPLE (follow this exact code pattern/style, adapt signal + metric
    per test; port names below are illustrative — use the real ones above) ===
\`\`\`matlab
fprintf('Running TC-EXAMPLE-01...\\n');
tVec = (0:ts:5)';
sigA = 50*sin(2*pi*2*tVec);
inputs.(genvarname('${ports[0]}')) = sigA;
% ... build one signal per port in "ports" list above, using ones()/zeros()
% for boolean flags, sin() for dynamic tests, step-like vectors for boundary
% tests, etc.
[t, y] = runModelSimulation(mdl, tVec, {sigA, ones(size(tVec)), zeros(size(tVec))}, ...
    {'${ports[0]}'${ports[1] ? `, '${ports[1]}'` : ""}${ports[2] ? `, '${ports[2]}'` : ""}});
measuredMetric = max(abs(y(t>1)));  % replace with the metric that fits THIS test
expected = 0; tol = 1;
isPass = abs(measuredMetric - expected) <= tol;
results = [results; {'TC-EXAMPLE-01','Metric name',measuredMetric,expected,tol, ...
    ternary(isPass,"PASS","FAIL"),'Short note'}];
saveData(t, {sigA, ones(size(tVec)), zeros(size(tVec))}, ...
    {'${ports[0]}'${ports[1] ? `, '${ports[1]}'` : ""}${ports[2] ? `, '${ports[2]}'` : ""}}, y, 'TC-EXAMPLE-01', dataDir);
plotTestCase(t, {sigA}, {'${ports[0]}'}, y, 'TC-EXAMPLE-01', 'Example Title', plotsDir);
\`\`\`

=== BASE MATLAB TEMPLATE (fill in the marked sections only; keep everything
    else, including the local functions at the bottom, exactly as given) ===
%% MBD_TestSuite.m
% Automated test runner for MBD Verification
% Model: ${modelName}
% Requirement ID: ${requirementId}

clear; clc; close all;

%% ============ CONFIG ============
mdl             = '${modelName}';
ts              = 0.005;                    % 200 Hz sample time
dataDir         = 'test_data';
plotsDir        = 'test_plots';
reportFile      = '${reportFile}';
csvFile         = '${csvFile}';

load_system(mdl);

% Initialize results table
results = table('Size',[0 7], ...
    'VariableTypes',{'string','string','double','double','double','string','string'}, ...
    'VariableNames',{'TestCaseID','Metric','Measured','Expected','Tolerance','Result','Notes'});

% Fixed Test Case IDs -- DO NOT CHANGE
ids = {${idsLiteral}};

% Metadata map for report generation -- fill Title/Objective/Input/Criterion
% for EACH id above, derived from the requirement text.
meta = containers.Map();
% [INSERT ONE meta('TC-...') = struct(...) LINE PER TEST CASE ID HERE]


%% ============ TEST CASES EXECUTION ============

% [INSERT ${count} FULLY IMPLEMENTED TEST CASE BLOCKS HERE, ONE PER ID ABOVE,
%  FOLLOWING THE WORKED EXAMPLE PATTERN AND HARD RULES ABOVE]


%% ============ GENERATE REPORTS ============
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
fprintf('All scope plots are open as MATLAB figure windows (saved as PNGs under: %s\\\\)\\n', plotsDir);
fprintf('\\nTest suite complete.\\n');


%% ===================== LOCAL FUNCTIONS (copy verbatim, do not modify) =====================

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
    % Generic multi-signal logger: one column per input port + output.
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
    % Generic scope-style plot: overlays all input signals on top subplot,
    % output on bottom subplot.
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

    subPara = Paragraph('${requirementId}: ${testIds[0]} through ${testIds[testIds.length - 1]}');
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

    footerPara = Paragraph(['Auto-generated engineering test report. ' ...
        'Scope plots are kept in MATLAB figure windows and saved as PNG files.']);
    footerPara.Style = {FontSize('9pt'), Italic(true), Color('#888888')};
    append(d, footerPara);

    close(d);
    fprintf('DOCX report generated successfully: %s\\n', reportFile);
end

=== OUTPUT FORMAT ===
Output ONLY the complete, fully valid, executable MATLAB code. No markdown
fences, no commentary before or after the code.
`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      temperature: 0.2, // deterministic engineering code, not creative writing
      maxOutputTokens: 8192,
    },

  });

  const raw = response.text ?? "";
  const code = stripMarkdownFences(raw);
  validateGeneratedScript(code, testIds, reportFile, csvFile);
  return code;
}

/** Strips ```matlab / ``` fences the model may add despite instructions not to. */
function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:matlab)?\s*\n/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/** Cheap static sanity check before this ever reaches MATLAB, so a bad
 *  generation fails fast in your app instead of silently shipping a
 *  half-implemented script. */
function validateGeneratedScript(
  code: string,
  testIds: string[],
  reportFile: string,
  csvFile: string
): void {
  const problems: string[] = [];

  for (const id of testIds) {
    if (!code.includes(id)) {
      problems.push(`Missing test case ID '${id}' in generated script.`);
    }
  }

  if (!code.includes(reportFile)) {
    problems.push(`Generated script does not reference expected report file '${reportFile}'.`);
  }
  if (!code.includes(csvFile)) {
    problems.push(`Generated script does not reference expected csv file '${csvFile}'.`);
  }

  const pendingCount = (code.match(/"PENDING"/g) || []).length;
  if (pendingCount > Math.ceil(testIds.length * 0.2)) {
    problems.push(
      `Too many PENDING placeholders (${pendingCount}) for ${testIds.length} test cases — ` +
        `the model likely stubbed out real logic instead of implementing it.`
    );
  }

  if (!code.includes("function generateWordReport")) {
    problems.push("generateWordReport function body is missing from generated script.");
  }

  if (problems.length > 0) {
    throw new Error(
      "Generated MATLAB script failed validation:\n" + problems.map((p) => `- ${p}`).join("\n")
    );
  }
}