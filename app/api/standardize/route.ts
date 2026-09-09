import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, createPartFromBase64 } from "@google/genai";
import * as XLSX from "xlsx";
import {
  DEFAULT_STANDARDIZER_PROMPT,
  type StandardizedTestCase,
  type RequirementGroup,
} from "@/lib/standardizer-types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
/** Models known to support file attachments — fallback order */
const FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-3.5-flash-lite",
];
const DEFAULT_MODEL = FALLBACK_MODELS[0];

// Re-export for any server-side consumers
export { DEFAULT_STANDARDIZER_PROMPT, type StandardizedTestCase, type RequirementGroup };

/**
 * Prompt suffix that instructs the LLM to return ONLY JSON.
 * The JSON structure mirrors the Excel-friendly format:
 * Requirement ID as a column (so the automator page can parse it).
 */
const JSON_OUTPUT_INSTRUCTION = `

==================================================
OUTPUT FORMAT (STRICT JSON)
==================================================
Return ONLY a valid JSON array. No markdown, no code fences, no commentary.

Each element must be an object with EXACTLY these keys:

{
  "requirementId": "REQ-XXXXX",
  "testCases": [
    {
      "testCaseId": "TC-XXXXX-01",
      "title": "...",
      "objective": "...",
      "preconditions": "...",
      "ts": "...",
      "passFailCriteria": "...",
      "priority": "High|Medium|Low",
      "status": "Pass|Fail|Blocked|Not Run",
      "notes": "..."
    }
  ]
}

Rules:
- requirementId: preserve the original Requirement ID exactly. If missing, generate a logical unique one.
- testCaseId: preserve existing IDs. If missing, generate TC-[REQ-SHORT]-[SEQ] starting at 01.
- ts: preserve the sample time exactly. Leave empty string if unknown.
- priority: High, Medium, or Low.
- status: Pass, Fail, Blocked, or Not Run. Default "Not Run".
- Do NOT invent engineering values. Leave fields empty if unknown.
- Preserve ALL requirements and ALL test cases from the input. Do not drop, truncate, or summarize.
- CRITICAL: You MUST include every single requirement and every single test case. Do NOT stop early.
- Keep the original order of requirements and test cases.
`;

export function parseStandardizedText(text: string): {
  groups: RequirementGroup[];
  allTestCases: StandardizedTestCase[];
} {
  const lines = text.split(/\r?\n/);
  const groups: RequirementGroup[] = [];
  let currentReqId = "";
  let currentTestCases: StandardizedTestCase[] = [];

  const isHeaderRow = (line: string) => {
    const l = line.toLowerCase();
    return (
      (l.includes("test case id") || l.includes("tc id") || l.includes("testcase id")) &&
      (l.includes("title") || l.includes("objective") || l.includes("pass/fail"))
    );
  };

  const isDividerRow = (line: string) => {
    return /^[\s|:=-]+$/.test(line.trim());
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check if line is a table header or divider
    if (isHeaderRow(line) || isDividerRow(line)) {
      continue;
    }

    // Check if line is a pipe-separated test case row
    const isPipeRow = line.includes("|");
    const isDirectTcRow = line.toUpperCase().startsWith("TC-");

    if (isPipeRow || isDirectTcRow) {
      let parts: string[] = [];
      if (isPipeRow) {
        parts = line.split("|").map((p) => p.trim());
        if (parts.length > 0 && parts[0] === "") parts.shift();
        if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
      } else {
        parts = line.split(/\t+/).map((p) => p.trim());
      }

      if (parts.length >= 2) {
        const firstCol = parts[0] || "";
        if (isHeaderRow(firstCol)) continue;

        const effectiveReqId = currentReqId || "REQ-GENERAL";

        const tc: StandardizedTestCase = {
          testCaseId: firstCol || `TC-${currentTestCases.length + 1}`,
          requirementId: effectiveReqId,
          title: parts[1] || "",
          objective: parts[2] || "",
          preconditions: parts[3] || "",
          ts: parts[4] || "",
          passFailCriteria: parts[5] || "",
          priority: parts[6] || "High",
          status: parts[7] || "Not Run",
          notes: parts[8] || "",
        };

        currentTestCases.push(tc);
        continue;
      }
    }

    // Otherwise, this line is likely a REQUIREMENT ID header
    const cleanHeader = line
      .replace(/^[#\s*]+/, "")
      .replace(/[*#:]+$/, "")
      .trim();

    if (
      cleanHeader &&
      !cleanHeader.toLowerCase().startsWith("user input") &&
      !cleanHeader.startsWith("---") &&
      !cleanHeader.startsWith("===")
    ) {
      if (currentTestCases.length > 0) {
        groups.push({
          requirementId: currentReqId || "REQ-GENERAL",
          testCases: currentTestCases,
        });
        currentTestCases = [];
      }
      currentReqId = cleanHeader;
    }
  }

  if (currentTestCases.length > 0) {
    groups.push({
      requirementId: currentReqId || "REQ-GENERAL",
      testCases: currentTestCases,
    });
  }

  const allTestCases = groups.flatMap((g) => g.testCases);
  return { groups, allTestCases };
}

/** Excel column order for the standardized output (flat, automator-friendly) */
const EXCEL_COLS = [
  "Requirement ID",
  "Test Case ID",
  "Title",
  "Objective",
  "Preconditions",
  "ts (s)",
  "Pass/Fail Criteria",
  "Priority",
  "Status",
  "Notes",
];

/* ─── Helpers ────────────────────────────────────────────────── */

/** Convert a base64 XLSX to a text table the LLM can read if file attachment fails. */
function excelBase64ToTextTable(b64: string): string {
  try {
    const buf = Buffer.from(b64, "base64");
    const wb = XLSX.read(buf, { type: "buffer" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const rows: string[][] = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: "",
        raw: false,
      }) as string[][];
      if (rows.length === 0) continue;
      parts.push(`--- Sheet: ${name} ---`);
      for (const row of rows) {
        parts.push(row.map((c) => String(c).trim()).join(" | "));
      }
    }
    return parts.join("\n");
  } catch {
    return "";
  }
}

/** Extract response text from GenerateContentResponse, handling edge cases. */
function extractResponseText(response: Awaited<ReturnType<typeof ai.models.generateContent>>): string {
  // Primary: use the .text getter (concatenates text parts from first candidate)
  const text = (response.text ?? "").trim();
  if (text) return text;

  // Fallback: manually walk candidates → content → parts
  const candidates = response.candidates;
  if (candidates && candidates.length > 0) {
    const parts = candidates[0]?.content?.parts;
    if (parts && parts.length > 0) {
      return parts
        .map((p) => (typeof p === "object" && "text" in p ? p.text ?? "" : ""))
        .join("")
        .trim();
    }
  }
  return "";
}

/**
 * Aggressively extract a JSON array from arbitrary LLM text output.
 * Tries: (1) direct parse, (2) markdown fence extraction, (3) bracket search,
 * (4) multiple array extraction, (5) object-per-line NDJSON.
 */
function extractJsonArray(raw: string): { requirementId: string; testCases: Record<string, string>[] }[] | null {
  if (!raw) return null;

  // Strip markdown code fences
  let s = raw.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g, "$1").trim();

  // Attempt 1: direct parse
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      // Might be a single object — wrap it
      if (parsed.requirementId || parsed.testCases) return [parsed];
    }
  } catch { /* continue */ }

  // Attempt 2: find outermost [ ... ]
  const arrStart = s.indexOf("[");
  const arrEnd = s.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    const candidate = s.substring(arrStart, arrEnd + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* continue */ }
  }

  // Attempt 3: find multiple JSON objects separated by commas
  const objRegex = /\{[\s\S]*?"requirementId"[\s\S]*?\}/g;
  const objects: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = objRegex.exec(s)) !== null) {
    // Try to extract a balanced JSON object
    const start = m.index;
    let depth = 0;
    let end = start;
    for (let i = start; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end > start) {
      objects.push(s.substring(start, end));
    }
  }
  if (objects.length > 0) {
    try {
      const parsed = objects.map((o) => JSON.parse(o));
      return parsed;
    } catch { /* continue */ }
  }

  // Attempt 4: NDJSON (one JSON object per line)
  const lines = s.split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
  if (lines.length > 0) {
    try {
      const parsed = lines.map((l) => JSON.parse(l));
      return parsed;
    } catch { /* continue */ }
  }

  return null;
}

/* ─── POST Handler ───────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        {
          error:
            "GEMINI_API_KEY is not configured in the environment. Please add it to your environment variables.",
        },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { fileBase64, fileName, customPrompt, model: requestedModel } =
      body ?? {};

    if (
      !fileBase64 ||
      typeof fileBase64 !== "string" ||
      !fileBase64.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "No file provided. Please upload an Excel file to standardize.",
        },
        { status: 400 }
      );
    }

    const trimmedBase64 = fileBase64.trim();
    const selectedModel =
      typeof requestedModel === "string" && requestedModel.trim()
        ? requestedModel.trim()
        : DEFAULT_MODEL;

    // ── Build the prompt ──
    const basePrompt =
      typeof customPrompt === "string" && customPrompt.trim()
        ? customPrompt.trim()
        : DEFAULT_STANDARDIZER_PROMPT;

    // Also convert Excel to text table as fallback context
    const textTable = excelBase64ToTextTable(trimmedBase64);

    const fileNote = textTable
      ? `The attached Excel file "${fileName || "input.xlsx"}" contains the requirements and/or test cases to standardize.\n\nBelow is a text representation of the file contents:\n\n${textTable}`
      : `The attached Excel file "${fileName || "input.xlsx"}" contains the requirements and/or test cases to standardize.`;

    let finalPrompt: string;
    if (basePrompt.includes("{{USER_INPUT}}")) {
      finalPrompt = basePrompt.replace(/\{\{USER_INPUT\}\}/g, fileNote);
    } else {
      finalPrompt = `${basePrompt}\n\n==================================================\nUSER INPUT\n==================================================\n${fileNote}`;
    }

    // Append the JSON output instruction so the LLM returns parseable JSON
    finalPrompt += JSON_OUTPUT_INSTRUCTION;

    // ── Try file-attachment approach first, then fallback models ──
    let responseText = "";
    let lastError: unknown = null;

    const modelsToTry = [selectedModel, ...FALLBACK_MODELS.filter((m) => m !== selectedModel)];

    for (const model of modelsToTry) {
      try {
        console.log(`[standardize] Trying model: ${model}`);

        const excelPart = createPartFromBase64(
          trimmedBase64,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [{ text: finalPrompt }, excelPart],
            },
          ],
          config: {
            systemInstruction:
              "You are an Automotive Software Test Requirement Standardization Engine. Return ONLY a valid JSON array — no markdown, no code fences, no commentary. Include EVERY requirement and test case — do not truncate.",
            temperature: 0.1,
            maxOutputTokens: 65536,
          },
        });

        responseText = extractResponseText(response);
        console.log(`[standardize] Model ${model} response length: ${responseText.length}`);

        if (responseText) {
          const jsonResult = extractJsonArray(responseText);
          if (jsonResult && jsonResult.length > 0) {
            console.log(`[standardize] Successfully parsed ${jsonResult.length} requirement groups from ${model}`);
            // ── Build Excel workbook (flat, one sheet with Requirement ID column) ──
            const rows: (string | number)[][] = [EXCEL_COLS];
            let totalTCs = 0;

            for (const group of jsonResult) {
              const reqId = group.requirementId || "REQ-UNKNOWN";
              const testCases = Array.isArray(group.testCases) ? group.testCases : [];
              for (const tc of testCases) {
                rows.push([
                  reqId,
                  (tc as Record<string, string>).testCaseId || "",
                  (tc as Record<string, string>).title || "",
                  (tc as Record<string, string>).objective || "",
                  (tc as Record<string, string>).preconditions || "",
                  (tc as Record<string, string>).ts || "",
                  (tc as Record<string, string>).passFailCriteria || "",
                  (tc as Record<string, string>).priority || "High",
                  (tc as Record<string, string>).status || "Not Run",
                  (tc as Record<string, string>).notes || "",
                ]);
                totalTCs++;
              }
            }

            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws["!cols"] = EXCEL_COLS.map((col, i) => {
              const maxLen = rows.reduce(
                (mx, row) => Math.max(mx, String(row[i] || "").length),
                col.length
              );
              return { wch: Math.min(maxLen + 2, 60) };
            });

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Standardized");
            const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
            const safeFileName = (fileName || "standardized_testcases")
              .replace(/\.[^.]+$/, "")
              .replace(/[^a-zA-Z0-9_\-]/g, "_");

            return new NextResponse(buffer, {
              headers: {
                "Content-Type":
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="${safeFileName}_standardized.xlsx"`,
              },
            });
          }
          console.log(`[standardize] JSON extraction failed for model ${model}. Response preview: ${responseText.substring(0, 300)}`);
        } else {
          console.log(`[standardize] Empty response from model ${model}`);
        }
      } catch (err) {
        lastError = err;
        console.error(`[standardize] Model ${model} failed:`, err instanceof Error ? err.message : err);
        continue;
      }
    }

    // If all models failed, try the text-only fallback (no file attachment)
    if (textTable) {
      try {
        console.log(`[standardize] Trying text-only fallback with ${FALLBACK_MODELS[0]}`);
        const textOnlyPrompt = finalPrompt.replace(
          /The attached Excel file[\s\S]*?Below is a text representation[\s\S]*?--- Sheet:[\s\S]*$/,
          `The following table contains the requirements and/or test cases to standardize:\n\n${textTable}`
        );

        const response = await ai.models.generateContent({
          model: FALLBACK_MODELS[0],
          contents: textOnlyPrompt,
          config: {
            systemInstruction:
              "You are an Automotive Software Test Requirement Standardization Engine. Return ONLY a valid JSON array — no markdown, no code fences, no commentary. Include EVERY requirement and test case — do not truncate.",
            temperature: 0.1,
            maxOutputTokens: 65536,
          },
        });

        responseText = extractResponseText(response);
        if (responseText) {
          const jsonResult = extractJsonArray(responseText);
          if (jsonResult && jsonResult.length > 0) {
            console.log(`[standardize] Text fallback succeeded with ${FALLBACK_MODELS[0]}`);
            const rows: (string | number)[][] = [EXCEL_COLS];
            for (const group of jsonResult) {
              const reqId = group.requirementId || "REQ-UNKNOWN";
              const testCases = Array.isArray(group.testCases) ? group.testCases : [];
              for (const tc of testCases) {
                rows.push([
                  reqId,
                  (tc as Record<string, string>).testCaseId || "",
                  (tc as Record<string, string>).title || "",
                  (tc as Record<string, string>).objective || "",
                  (tc as Record<string, string>).preconditions || "",
                  (tc as Record<string, string>).ts || "",
                  (tc as Record<string, string>).passFailCriteria || "",
                  (tc as Record<string, string>).priority || "High",
                  (tc as Record<string, string>).status || "Not Run",
                  (tc as Record<string, string>).notes || "",
                ]);
              }
            }
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws["!cols"] = EXCEL_COLS.map((col, i) => {
              const maxLen = rows.reduce(
                (mx, row) => Math.max(mx, String(row[i] || "").length),
                col.length
              );
              return { wch: Math.min(maxLen + 2, 60) };
            });
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Standardized");
            const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
            const safeFileName = (fileName || "standardized_testcases")
              .replace(/\.[^.]+$/, "")
              .replace(/[^a-zA-Z0-9_\-]/g, "_");
            return new NextResponse(buffer, {
              headers: {
                "Content-Type":
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="${safeFileName}_standardized.xlsx"`,
              },
            });
          }
        }
      } catch (err) {
        console.error(`[standardize] Text fallback failed:`, err instanceof Error ? err.message : err);
      }
    }

    // All attempts failed — return the raw response so the user can debug
    console.error(`[standardize] All models and fallbacks failed. Last error:`, lastError);
    return NextResponse.json(
      {
        error:
          "The LLM did not return any standardized test cases. " +
          "Please check the input file and try again. " +
          "You can also try a different model from the dropdown.",
        debug: {
          responsePreview: responseText.substring(0, 500),
          modelsAttempted: modelsToTry,
        },
      },
      { status: 422 }
    );
  } catch (err) {
    console.error("Standardize API error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "An unexpected error occurred during testcase standardization.",
      },
      { status: 500 }
    );
  }
}
