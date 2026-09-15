/**
 * Parse a signal/IO workbook and keep only Input and Output ports.
 * Internal / derived / intermediate rows are ignored.
 */

import * as XLSX from "xlsx";

export type PortIoRole = "Input" | "Output";

export interface ParsedPort {
  signalId: string;
  name: string;
  ioRole: PortIoRole;
  datatype: string;
  notes: string;
  module: string;
  sheet: string;
}

export interface ParsePortsResult {
  ports: ParsedPort[];
  inputs: ParsedPort[];
  outputs: ParsedPort[];
  skippedInternal: number;
  warnings: string[];
  sheets: string[];
}

interface PortColumnMap {
  signalId: number;
  name: number;
  ioRole: number;
  datatype: number;
  notes: number;
  module: number;
  headers: string[];
}

const SIGNAL_ID_PATTERNS = [
  /\bsignal\s*id\b/i,
  /\bsig[\s_\-]*id\b/i,
  /\bport\s*id\b/i,
];

const NAME_PATTERNS = [
  /\bsignal\s*name\b/i,
  /\bport\s*name\b/i,
  /\binport\s*name\b/i,
  /\boutport\s*name\b/i,
  /^\s*name\s*$/i,
];

const IO_ROLE_PATTERNS = [
  /\bio\s*role\b/i,
  /\bi\s*\/\s*o\s*role\b/i,
  /\bdirection\b/i,
  /\bport\s*(?:kind|type|dir(?:ection)?)\b/i,
  /\bio\b/i,
];

const DATATYPE_PATTERNS = [
  /\bdata\s*type\b/i,
  /\bdatatype\b/i,
  /\bdtype\b/i,
];

const NOTES_PATTERNS = [/\bnotes?\b/i, /\bcomments?\b/i, /\bremarks?\b/i];
const MODULE_PATTERNS = [/\bmodule\b/i, /\bsubsystem\b/i];

function cell(row: unknown[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  const v = row[idx];
  return v == null ? "" : String(v).trim();
}

function matchHeader(header: string, patterns: RegExp[]): boolean {
  const h = header.trim();
  if (!h) return false;
  return patterns.some((p) => p.test(h));
}

function detectColumnMap(headerRow: unknown[]): PortColumnMap {
  const headers = headerRow.map((h) =>
    h != null ? String(h).trim() : ""
  );

  const map: PortColumnMap = {
    signalId: -1,
    name: -1,
    ioRole: -1,
    datatype: -1,
    notes: -1,
    module: -1,
    headers,
  };

  headers.forEach((h, i) => {
    if (matchHeader(h, SIGNAL_ID_PATTERNS) && map.signalId === -1) map.signalId = i;
    else if (matchHeader(h, NAME_PATTERNS) && map.name === -1) map.name = i;
    else if (matchHeader(h, IO_ROLE_PATTERNS) && map.ioRole === -1) map.ioRole = i;
    else if (matchHeader(h, DATATYPE_PATTERNS) && map.datatype === -1) map.datatype = i;
    else if (matchHeader(h, MODULE_PATTERNS) && map.module === -1) map.module = i;
    else if (matchHeader(h, NOTES_PATTERNS) && map.notes === -1) map.notes = i;
  });

  return map;
}

function scoreHeaderMap(map: PortColumnMap): number {
  let score = 0;
  if (map.name !== -1) score += 4;
  if (map.ioRole !== -1) score += 4;
  if (map.signalId !== -1) score += 2;
  if (map.datatype !== -1) score += 1;
  return score;
}

function classifyIoRole(rawRole: string, signalId: string): PortIoRole | "Internal" | null {
  const role = rawRole.trim().toLowerCase().replace(/[_/]+/g, " ");

  if (
    /^(in|input|inport|in port)$/.test(role) ||
    /\binport\b/.test(role) ||
    /^in\b/.test(role)
  ) {
    return "Input";
  }
  if (
    /^(out|output|outport|out port)$/.test(role) ||
    /\boutport\b/.test(role) ||
    /^out\b/.test(role)
  ) {
    return "Output";
  }
  if (
    /\b(internal|derived|intermediate|local|virtual)\b/.test(role)
  ) {
    return "Internal";
  }

  // Fallback from Signal ID conventions: ARB-I01, ARB-OP1
  const id = signalId.trim().toUpperCase();
  if (/[-_]OP?\d*$/.test(id) || /[-_]OUT(?:PUT)?\d*$/.test(id)) return "Output";
  if (/[-_]I\d+/.test(id) || /[-_]IN(?:PUT)?\d*$/.test(id)) return "Input";

  return null;
}

function looksLikeSimulinkName(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(v);
}

function extractName(row: unknown[], map: PortColumnMap): string {
  const fromCol = cell(row, map.name);
  if (fromCol) return fromCol;

  // If Name column is missing, pick the first identifier-like cell that is not the ID
  for (let i = 0; i < row.length; i++) {
    if (i === map.signalId || i === map.ioRole || i === map.datatype) continue;
    const v = cell(row, i);
    if (looksLikeSimulinkName(v) && !/^(input|output|internal|boolean|double|enum)$/i.test(v)) {
      return v;
    }
  }
  return "";
}

export function parsePortsWorkbook(arrayBuffer: ArrayBuffer): ParsePortsResult {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const ports: ParsedPort[] = [];
  const warnings: string[] = [];
  let skippedInternal = 0;
  const seenNames = new Set<string>();

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
    });
    if (!rows || rows.length < 1) continue;

    let headerRowIndex = 0;
    let colMap = detectColumnMap(rows[0] || []);
    let bestScore = scoreHeaderMap(colMap);

    for (let r = 1; r < Math.min(rows.length, 12); r++) {
      const candidate = detectColumnMap(rows[r] || []);
      const score = scoreHeaderMap(candidate);
      if (score > bestScore) {
        bestScore = score;
        headerRowIndex = r;
        colMap = candidate;
      }
    }

    if (colMap.name === -1 && colMap.ioRole === -1) {
      warnings.push(
        `Sheet "${sheetName}": no Signal Name / IO Role columns detected.`
      );
      continue;
    }

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const allEmpty = row.every(
        (c) => c == null || String(c).trim() === ""
      );
      if (allEmpty) continue;

      const signalId = cell(row, colMap.signalId);
      const name = extractName(row, colMap);
      const rawRole = cell(row, colMap.ioRole);
      const io = classifyIoRole(rawRole, signalId);

      if (io === "Internal" || io === null) {
        if (io === "Internal") skippedInternal += 1;
        continue;
      }

      if (!name) {
        warnings.push(
          `Sheet "${sheetName}" row ${i + 1}: ${io} row skipped (missing signal name).`
        );
        continue;
      }

      const key = `${io}:${name.toLowerCase()}`;
      if (seenNames.has(key)) continue;
      seenNames.add(key);

      ports.push({
        signalId,
        name,
        ioRole: io,
        datatype: cell(row, colMap.datatype),
        notes: cell(row, colMap.notes),
        module: cell(row, colMap.module),
        sheet: sheetName,
      });
    }
  }

  const inputs = ports.filter((p) => p.ioRole === "Input");
  const outputs = ports.filter((p) => p.ioRole === "Output");

  if (ports.length === 0) {
    warnings.push(
      "No Input or Output ports found. Expected an IO Role column with Input/Output (Internal rows are ignored)."
    );
  }

  return {
    ports,
    inputs,
    outputs,
    skippedInternal,
    warnings,
    sheets: wb.SheetNames,
  };
}
