/**
 * Robust Excel Parser Engine
 * Handles arbitrary Excel layouts with dynamic column detection,
 * requirement/test-case relationship mapping, and merged cells.
 */

import * as XLSX from "xlsx";

/* ─── Types ──────────────────────────────────────────────────── */

export interface ParsedTestCase {
  testCaseId: string;
  requirementId: string;
  title: string;
  objective: string;
  preconditions: string;
  ts: string;
  passFailCriteria: string;
  priority: string;
  status: string;
  notes: string;
  /** All fields from the source Excel row, keyed by header name */
  allFields: Record<string, string>;
  sheet: string;
}

export interface RequirementGroup {
  requirementId: string;
  testCases: ParsedTestCase[];
}

export interface ParseResult {
  requirements: RequirementGroup[];
  testCases: ParsedTestCase[];
  warnings: string[];
  sheets: string[];
}

/* ─── Column Detection ───────────────────────────────────────── */

interface ColumnMap {
  reqId: number;
  tcId: number;
  title: number;
  objective: number;
  preconditions: number;
  ts: number;
  passFailCriteria: number;
  priority: number;
  status: number;
  notes: number;
  /** Columns we didn't map to a known field but are present */
  extraColumns: Map<number, string>;
  /** Raw header row values */
  headers: string[];
}

const REQ_ID_PATTERNS = [
  /\breq[\s_\-:.]*(id|no|number|#)/i,
  /\brequirement\s*(id|no|number|#|ref)?/i,
  /\breq[\s_\-]id\b/i,
  /\breq\b/i,
];

const TC_ID_PATTERNS = [
  /\b(?:test\s*case|tc|test)\s*(?:id|no|number|#|case\s*id)/i,
  /\btc[\s_\-]id\b/i,
  /\btest\s*case\s*id\b/i,
];

const TITLE_PATTERNS = [
  /\btitle\b/i,
  /\bname\b/i,
  /\bdescription\b/i,
  /\btest\s*case\s*name\b/i,
];

const OBJECTIVE_PATTERNS = [
  /\bobjective\b/i,
  /\bgoal\b/i,
  /\bpurpose\b/i,
  /\bverification\s*objective\b/i,
];

const PRECONDITIONS_PATTERNS = [
  /\bprecondition/i,
  /\binitial\s*condition/i,
  /\bprerequisit/i,
  /\bsetup\b/i,
];

const TS_PATTERNS = [
  /\bts\s*\(s\)/i,
  /\bsample\s*time/i,
  /\bts\b/,
];

const PASSFAIL_PATTERNS = [
  /\bpass\/?fail\s*criteria/i,
  /\bpass\s*\/\s*fail/i,
  /\bacceptance\s*criteria/i,
  /\bexpected\s*result/i,
  /\bverdict/i,
];

const PRIORITY_PATTERNS = [
  /\bpriority\b/i,
  /\bseverity\b/i,
];

const STATUS_PATTERNS = [
  /\bstatus\b/i,
  /\bexecution\s*status\b/i,
  /\bresult\b/i,
];

const NOTES_PATTERNS = [
  /\bnotes?\b/i,
  /\bcomments?\b/i,
  /\bremarks?\b/i,
  /\bremarks\b/i,
];

/** Require Requirement ID column to have at least this many non-empty values */
const MIN_REQ_OCCURRENCES = 1;

/* ─── Pattern Matching Helpers ───────────────────────────────── */

function matchHeader(
  header: string,
  patterns: RegExp[]
): boolean {
  const h = header.trim();
  if (!h) return false;
  return patterns.some((p) => p.test(h));
}

/**
 * Detect whether a cell value looks like a Requirement ID
 * (e.g., REQ-001, REQ-IB_BHMS-SC-PSB-002, REQXXX, etc.)
 */
function looksLikeReqId(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /^REQ[\s_\-:.]/i.test(v) || /^REQ$/i.test(v);
}

/**
 * Detect whether a cell value looks like a Test Case ID
 * (e.g., TC-001, TC-PSB-002-01, TC123, etc.)
 */
function looksLikeTcId(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /^TC[\s_\-:.]/i.test(v) || /^TC$/i.test(v);
}

/* ─── Core Parser ────────────────────────────────────────────── */

function detectColumnMap(headerRow: unknown[]): ColumnMap {
  const headers = headerRow.map((h) =>
    h !== null && h !== undefined ? String(h).trim() : ""
  );

  const map: ColumnMap = {
    reqId: -1,
    tcId: -1,
    title: -1,
    objective: -1,
    preconditions: -1,
    ts: -1,
    passFailCriteria: -1,
    priority: -1,
    status: -1,
    notes: -1,
    extraColumns: new Map(),
    headers,
  };

  headers.forEach((h, i) => {
    if (matchHeader(h, TC_ID_PATTERNS) && map.tcId === -1) map.tcId = i;
    else if (matchHeader(h, REQ_ID_PATTERNS) && map.reqId === -1) map.reqId = i;
    else if (matchHeader(h, TITLE_PATTERNS) && map.title === -1) map.title = i;
    else if (matchHeader(h, OBJECTIVE_PATTERNS) && map.objective === -1) map.objective = i;
    else if (matchHeader(h, PRECONDITIONS_PATTERNS) && map.preconditions === -1) map.preconditions = i;
    else if (matchHeader(h, TS_PATTERNS) && map.ts === -1) map.ts = i;
    else if (matchHeader(h, PASSFAIL_PATTERNS) && map.passFailCriteria === -1) map.passFailCriteria = i;
    else if (matchHeader(h, PRIORITY_PATTERNS) && map.priority === -1) map.priority = i;
    else if (matchHeader(h, STATUS_PATTERNS) && map.status === -1) map.status = i;
    else if (matchHeader(h, NOTES_PATTERNS) && map.notes === -1) map.notes = i;
    else if (h && map.extraColumns.size < 50) {
      map.extraColumns.set(i, h);
    }
  });

  return map;
}

/**
 * If no header-mapped columns were found, try to detect by
 * scanning the first few data rows for pattern matches.
 */
function detectByContent(
  rows: unknown[][],
  startIndex: number
): { reqIdCol: number; tcIdCol: number } {
  let reqIdCol = -1;
  let tcIdCol = -1;

  const scanLimit = Math.min(rows.length, startIndex + 15);
  const reqCandidates = new Map<number, number>();
  const tcCandidates = new Map<number, number>();

  for (let i = startIndex; i < scanLimit; i++) {
    const row = rows[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const val = row[j] != null ? String(row[j]).trim() : "";
      if (!val) continue;
      if (looksLikeReqId(val)) {
        reqCandidates.set(j, (reqCandidates.get(j) || 0) + 1);
      }
      if (looksLikeTcId(val)) {
        tcCandidates.set(j, (tcCandidates.get(j) || 0) + 1);
      }
    }
  }

  // Pick the column with the most matches
  let maxReq = 0;
  reqCandidates.forEach((count, col) => {
    if (count > maxReq) {
      maxReq = count;
      reqIdCol = col;
    }
  });

  let maxTc = 0;
  tcCandidates.forEach((count, col) => {
    if (count > maxTc) {
      maxTc = count;
      tcIdCol = col;
    }
  });

  // If reqIdCol and tcIdCol are the same column, that's wrong —
  // it means the column has both REQ and TC IDs. In that case,
  // we treat it as a mixed column and rely on per-cell detection.
  if (reqIdCol === tcIdCol && reqIdCol !== -1) {
    reqIdCol = -1; // Will use per-cell detection instead
  }

  return { reqIdCol, tcIdCol };
}

/**
 * Build all fields record from a row using the column map.
 * Maps known columns to standard keys and preserves extras.
 */
function rowToFields(
  row: unknown[],
  colMap: ColumnMap,
  headers: string[]
): Record<string, string> {
  const fields: Record<string, string> = {};

  // Map standard fields
  const mappings: [number, string][] = [
    [colMap.tcId, "Test Case ID"],
    [colMap.reqId, "Requirement ID"],
    [colMap.title, "Title"],
    [colMap.objective, "Objective"],
    [colMap.preconditions, "Preconditions"],
    [colMap.ts, "ts (s)"],
    [colMap.passFailCriteria, "Pass/Fail Criteria"],
    [colMap.priority, "Priority"],
    [colMap.status, "Status"],
    [colMap.notes, "Notes"],
  ];

  for (const [colIdx, fieldName] of mappings) {
    if (colIdx >= 0 && colIdx < row.length) {
      const val = row[colIdx];
      fields[fieldName] = val != null ? String(val).trim() : "";
    }
  }

  // Preserve extra columns
  colMap.extraColumns.forEach((headerName, colIdx) => {
    if (colIdx < row.length) {
      const val = row[colIdx];
      fields[headerName] = val != null ? String(val).trim() : "";
    }
  });

  // Also preserve any unmapped columns using their header names
  for (let i = 0; i < row.length; i++) {
    if (i < headers.length && headers[i]) {
      const already = Object.values(fields).includes(
        row[i] != null ? String(row[i]).trim() : ""
      );
      const key = headers[i];
      if (!(key in fields)) {
        const val = row[i];
        fields[key] = val != null ? String(val).trim() : "";
      }
    }
  }

  return fields;
}

/**
 * Extract the test case ID from a row, trying the mapped column first,
 * then scanning the row for cells that look like TC IDs.
 */
function extractTcId(row: unknown[], colMap: ColumnMap): string {
  // Try the mapped column first
  if (colMap.tcId >= 0 && colMap.tcId < row.length) {
    const val = row[colMap.tcId];
    if (val != null && String(val).trim()) return String(val).trim();
  }

  // If reqIdCol == -1 and we detect by content, scan all cells
  // Check if the mapped TC ID column actually contains TC IDs
  if (colMap.tcId >= 0 && colMap.tcId < row.length) {
    const val = row[colMap.tcId];
    if (val != null && looksLikeTcId(String(val))) return String(val).trim();
  }

  // Scan row for any cell that looks like a TC ID
  for (let i = 0; i < row.length; i++) {
    const val = row[i];
    if (val != null && looksLikeTcId(String(val))) return String(val).trim();
  }

  return "";
}

/**
 * Extract the requirement ID from a row, trying the mapped column first,
 * then scanning for cells that look like REQ IDs.
 */
function extractReqId(row: unknown[], colMap: ColumnMap): string {
  if (colMap.reqId >= 0 && colMap.reqId < row.length) {
    const val = row[colMap.reqId];
    if (val != null && String(val).trim()) return String(val).trim();
  }

  // Scan for any cell that looks like a REQ ID
  for (let i = 0; i < row.length; i++) {
    const val = row[i];
    if (val != null && looksLikeReqId(String(val))) return String(val).trim();
  }

  return "";
}

/**
 * Detect whether a row is a header-like row (should be skipped).
 */
function isHeaderLikeRow(row: unknown[], colMap: ColumnMap): boolean {
  if (!colMap.headers || colMap.headers.length === 0) return false;

  // Check if most non-empty cells match known header patterns
  let matchCount = 0;
  let totalNonEmpty = 0;

  for (let i = 0; i < row.length; i++) {
    const val = row[i] != null ? String(row[i]).trim() : "";
    if (!val) continue;
    totalNonEmpty++;

    const headerVal = colMap.headers[i] || "";
    // Check if this cell value is the same as the header
    if (val.toLowerCase() === headerVal.toLowerCase()) {
      matchCount++;
    }
  }

  return totalNonEmpty > 0 && matchCount / totalNonEmpty > 0.5;
}

/* ─── Main Export ────────────────────────────────────────────── */

/**
 * Parse an Excel file buffer into a structured Requirement → Test Case hierarchy.
 */
export function parseExcelWorkbook(arrayBuffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const allRequirements: RequirementGroup[] = [];
  const allTestCases: ParsedTestCase[] = [];
  const warnings: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
    });

    if (!rows || rows.length < 1) continue;

    // Step 1: Find the header row
    // Look for a row that contains recognisable column names
    let headerRowIndex = 0;
    let colMap: ColumnMap | null = null;

    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const candidateMap = detectColumnMap(rows[r] || []);
      // If we found at least TC ID or REQ ID in headers, this is our header row
      if (
        candidateMap.tcId !== -1 ||
        candidateMap.reqId !== -1 ||
        candidateMap.title !== -1 ||
        candidateMap.objective !== -1
      ) {
        headerRowIndex = r;
        colMap = candidateMap;
        break;
      }
    }

    // Fallback: if no header row found, use row 0 and detect by content
    if (!colMap) {
      colMap = detectColumnMap(rows[0] || []);
    }

    const headers = colMap.headers;

    // Step 2: If we couldn't detect TC/REQ columns from headers, try content detection
    if (colMap.tcId === -1 && colMap.reqId === -1) {
      const contentDetection = detectByContent(rows, headerRowIndex + 1);
      colMap.tcId = contentDetection.tcIdCol;
      colMap.reqId = contentDetection.reqIdCol;
    }

    // Step 3: Parse data rows
    let currentReqId = "";
    const sheetRequirements: RequirementGroup[] = [];
    const reqMap = new Map<string, RequirementGroup>();
    let tcCounter = 0;

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      // Skip rows that are all empty
      const allEmpty = row.every(
        (cell) => cell === null || cell === undefined || String(cell).trim() === ""
      );
      if (allEmpty) continue;

      // Skip header-like duplicate rows
      if (isHeaderLikeRow(row, colMap)) continue;

      // Extract test case ID
      const tcId = extractTcId(row, colMap);

      // Extract requirement ID from this row
      const rowReqId = extractReqId(row, colMap);

      // If this row has a requirement ID but no TC ID, it might be a
      // "requirement header" row (the requirement is stated on its own line)
      if (rowReqId && !tcId) {
        currentReqId = rowReqId;
        // Check if a group already exists for this requirement
        if (!reqMap.has(currentReqId)) {
          const group: RequirementGroup = {
            requirementId: currentReqId,
            testCases: [],
          };
          reqMap.set(currentReqId, group);
          sheetRequirements.push(group);
        }
        continue;
      }

      // If this row has both a requirement ID and a TC ID
      if (rowReqId && tcId) {
        currentReqId = rowReqId;
        if (!reqMap.has(currentReqId)) {
          const group: RequirementGroup = {
            requirementId: currentReqId,
            testCases: [],
          };
          reqMap.set(currentReqId, group);
          sheetRequirements.push(group);
        }
      }

      // If we have a TC ID but no requirement ID on this row,
      // associate with the current requirement
      if (tcId) {
        if (!currentReqId) {
          currentReqId = "REQ-UNASSIGNED";
          if (!reqMap.has(currentReqId)) {
            const group: RequirementGroup = {
              requirementId: currentReqId,
              testCases: [],
            };
            reqMap.set(currentReqId, group);
            sheetRequirements.push(group);
          }
        }

        const fields = rowToFields(row, colMap, headers);

        // Ensure requirement ID is set in the fields
        if (!fields["Requirement ID"]) {
          fields["Requirement ID"] = currentReqId;
        }
        // Ensure TC ID is set
        if (!fields["Test Case ID"]) {
          fields["Test Case ID"] = tcId;
        }

        const tc: ParsedTestCase = {
          testCaseId: tcId,
          requirementId: currentReqId,
          title: fields["Title"] || "",
          objective: fields["Objective"] || "",
          preconditions: fields["Preconditions"] || "",
          ts: fields["ts (s)"] || "",
          passFailCriteria: fields["Pass/Fail Criteria"] || "",
          priority: fields["Priority"] || "",
          status: fields["Status"] || "",
          notes: fields["Notes"] || "",
          allFields: fields,
          sheet: sheetName,
        };

        // Add to the current requirement group
        const group = reqMap.get(currentReqId)!;
        group.testCases.push(tc);
        allTestCases.push(tc);
        tcCounter++;
        continue;
      }

      // Row has neither TC ID nor REQ ID
      // Check if this row has useful data and is associated with a current requirement
      // (e.g., a continuation row with additional fields for the last TC)
      if (currentReqId && tcCounter > 0 && row.some((c) => c != null && String(c).trim() !== "")) {
        // This might be a continuation row — merge fields into the last TC
        const group = reqMap.get(currentReqId);
        if (group && group.testCases.length > 0) {
          const lastTc = group.testCases[group.testCases.length - 1];
          const extraFields = rowToFields(row, colMap, headers);
          // Only merge non-empty values
          Object.entries(extraFields).forEach(([key, val]) => {
            if (val && !lastTc.allFields[key]) {
              lastTc.allFields[key] = val;
            }
          });
        }
      }
    }

    allRequirements.push(...sheetRequirements);

    if (sheetRequirements.length === 0 && rows.length > 1) {
      warnings.push(
        `Sheet "${sheetName}": No requirements or test cases detected. ` +
        `The column layout may not be recognized.`
      );
    }
  }

  return {
    requirements: allRequirements,
    testCases: allTestCases,
    warnings,
    sheets: wb.SheetNames,
  };
}

/* ─── Formatting for LLM ────────────────────────────────────── */

/**
 * Convert parsed data into a clean text format for the LLM.
 * Uses JSON internally for accuracy, but renders a human-readable
 * structured format that the LLM can easily parse.
 */
export function formatForLLM(result: ParseResult): string {
  const parts: string[] = [];

  for (const req of result.requirements) {
    parts.push(`REQUIREMENT: ${req.requirementId}`);
    parts.push("");

    for (const tc of req.testCases) {
      parts.push(`TEST CASE: ${tc.testCaseId}`);

      // Output all fields from the Excel
      for (const [key, value] of Object.entries(tc.allFields)) {
        // Skip the ID fields (already shown in the header)
        if (key === "Test Case ID" || key === "Requirement ID") continue;
        if (value) {
          parts.push(`${key}: ${value}`);
        }
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}

/**
 * Convert parsed data to JSON string for the LLM.
 * JSON format prevents the LLM from confusing requirements and test cases.
 */
export function formatAsJSON(result: ParseResult): string {
  const structured = result.requirements.map((req) => ({
    requirementId: req.requirementId,
    testCases: req.testCases.map((tc) => ({
      testCaseId: tc.testCaseId,
      ...tc.allFields,
    })),
  }));

  return JSON.stringify(structured, null, 2);
}

/* ─── Validation ────────────────────────────────────────────── */

export function validateParseResult(result: ParseResult): string[] {
  const errors: string[] = [];
  const seenTcIds = new Set<string>();

  for (const req of result.requirements) {
    if (!req.requirementId || req.requirementId.trim() === "") {
      errors.push("Found a requirement with an empty ID.");
    }

    for (const tc of req.testCases) {
      if (!tc.testCaseId || tc.testCaseId.trim() === "") {
        errors.push(
          `Test case under "${req.requirementId}" has an empty ID.`
        );
      }

      if (seenTcIds.has(tc.testCaseId)) {
        errors.push(
          `Duplicate test case ID "${tc.testCaseId}" found under "${req.requirementId}".`
        );
      }
      seenTcIds.add(tc.testCaseId);

      if (tc.requirementId !== req.requirementId) {
        errors.push(
          `Test case "${tc.testCaseId}" has requirement ID "${tc.requirementId}" ` +
          `but is grouped under "${req.requirementId}".`
        );
      }
    }
  }

  // Check that every parsed test case belongs to a requirement
  const requirementTcIds = new Set(
    result.requirements.flatMap((r) => r.testCases.map((tc) => tc.testCaseId))
  );
  for (const tc of result.testCases) {
    if (!requirementTcIds.has(tc.testCaseId)) {
      errors.push(
        `Test case "${tc.testCaseId}" is not associated with any requirement.`
      );
    }
  }

  return errors;
}
