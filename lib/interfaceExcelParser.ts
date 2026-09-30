/**
 * Interface Excel Parser & Model Interface Data Structures
 * 
 * Supports parsing automotive & Simulink model interface Excel workbooks into
 * a clean, extensible, hierarchical ModelInterface JSON structure.
 */

import * as XLSX from "xlsx";

/* ─── TypeScript Types ─────────────────────────────────────────── */

export type SignalType = "real" | "complex" | "enum" | "boolean" | string;

export interface InterfaceSignal {
  id: string;
  name: string;
  dimensions?: number[] | string | null;
  data_type?: string;
  signal_type?: SignalType;
  wheel_order?: string[];
  enum_values?: string;
  enum_class?: string;
  metadata?: Record<string, unknown>;
}

export interface InterfaceBusElement extends InterfaceSignal {
  is_bus?: boolean;
  elements?: InterfaceBusElement[];
}

export interface InterfaceBus {
  id: string;
  name: string;
  elements: InterfaceBusElement[];
  metadata?: Record<string, unknown>;
}

export interface InterfacePort extends InterfaceSignal {
  // top-level port
}

export interface InterfaceGroup {
  buses: InterfaceBus[];
  ports: InterfacePort[];
}

export interface ModelInterface {
  inputs: InterfaceGroup;
  outputs: InterfaceGroup;
  metadata?: Record<string, unknown>;
}

export interface ValidationError {
  path: string;
  field: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  isValid: boolean;
  hasErrors: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface ParseInterfaceResult {
  interfaceData: ModelInterface;
  totalInputs: number;
  totalOutputs: number;
  totalBuses: number;
  warnings: string[];
  sheets: string[];
}

/* ─── Clean Export Interfaces (no UI `id` fields) ─────────────── */

export interface CleanSignal {
  name: string;
  dimensions?: number[] | string | null;
  data_type?: string;
  signal_type?: string;
  wheel_order?: string[];
  enum_values?: string;
  enum_class?: string;
  metadata?: Record<string, unknown>;
}

export interface CleanBusElement extends CleanSignal {
  elements?: CleanBusElement[];
}

export interface CleanBus {
  name: string;
  elements: CleanBusElement[];
  metadata?: Record<string, unknown>;
}

export interface CleanInterfaceGroup {
  buses: CleanBus[];
  ports: CleanSignal[];
}

export interface CleanModelInterface {
  inputs: CleanInterfaceGroup;
  outputs: CleanInterfaceGroup;
  metadata?: Record<string, unknown>;
}

/* ─── ID Generator ─────────────────────────────────────────────── */

let idCounter = 0;
export function generateId(prefix = "item"): string {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}_${Math.random().toString(36).substring(2, 7)}`;
}

/* ─── Factory Helpers ─────────────────────────────────────────── */

export function createEmptyInterface(): ModelInterface {
  return {
    inputs: {
      buses: [],
      ports: [],
    },
    outputs: {
      buses: [],
      ports: [],
    },
  };
}

export function createEmptyPort(name = "NewPort"): InterfacePort {
  return {
    id: generateId("port"),
    name,
    dimensions: [1, 1],
    data_type: "double",
    signal_type: "real",
    metadata: {},
  };
}

export function createEmptyBus(name = "NewBus"): InterfaceBus {
  return {
    id: generateId("bus"),
    name,
    elements: [],
    metadata: {},
  };
}

export function createEmptyBusElement(name = "NewElement", isBus = false): InterfaceBusElement {
  if (isBus) {
    return {
      id: generateId("bus_elem"),
      name,
      is_bus: true,
      elements: [],
      metadata: {},
    };
  }
  return {
    id: generateId("elem"),
    name,
    dimensions: [1, 1],
    data_type: "double",
    signal_type: "real",
    metadata: {},
  };
}

/* ─── Dimension Parser & Formatter ────────────────────────────── */

export function parseDimensionString(dim: unknown): {
  parsed: number[] | null;
  raw: string;
  isValid: boolean;
} {
  if (dim == null) {
    return { parsed: null, raw: "", isValid: true };
  }

  if (Array.isArray(dim)) {
    const nums = dim.map((v) => Number(v));
    const allValid = nums.every((n) => Number.isFinite(n) && n > 0);
    return {
      parsed: allValid ? nums : null,
      raw: JSON.stringify(dim),
      isValid: allValid,
    };
  }

  if (typeof dim === "number") {
    if (Number.isFinite(dim) && dim > 0) {
      // Single number N -> [1, N] or [1, 1] if 1
      const p = dim === 1 ? [1, 1] : [1, Math.round(dim)];
      return { parsed: p, raw: String(dim), isValid: true };
    }
    return { parsed: null, raw: String(dim), isValid: false };
  }

  const raw = String(dim).trim();
  if (!raw) {
    return { parsed: null, raw: "", isValid: true };
  }

  // Remove surrounding brackets or parens: "[1, 4]" -> "1, 4", "[1 4]" -> "1 4"
  const cleaned = raw.replace(/^[\[\(]\s*/, "").replace(/\s*[\]\)]$/, "").trim();

  // Pattern: "1 x 4" or "1x4" or "1 X 4" or "1*4" or "1 * 4"
  const multMatch = cleaned.match(/^(\d+)\s*[*xX×]\s*(\d+)(?:\s*[*xX×]\s*(\d+))?$/);
  if (multMatch) {
    const d1 = parseInt(multMatch[1], 10);
    const d2 = parseInt(multMatch[2], 10);
    if (multMatch[3]) {
      const d3 = parseInt(multMatch[3], 10);
      return { parsed: [d1, d2, d3], raw, isValid: true };
    }
    return { parsed: [d1, d2], raw, isValid: true };
  }

  // Pattern: "1, 4" or "1,4" or "1 4" or "1; 4"
  const sepMatch = cleaned.split(/[\s,;]+/).filter(Boolean);
  if (sepMatch.length >= 2) {
    const parsedNums = sepMatch.map((s) => parseInt(s, 10));
    if (parsedNums.every((n) => Number.isFinite(n) && !isNaN(n) && n > 0)) {
      return { parsed: parsedNums, raw, isValid: true };
    }
  }

  // Pattern: single integer "4" -> [1, 4], "1" -> [1, 1]
  if (/^\d+$/.test(cleaned)) {
    const n = parseInt(cleaned, 10);
    if (n > 0) {
      return { parsed: n === 1 ? [1, 1] : [1, n], raw, isValid: true };
    }
  }

  // Unresolved / unknown dimension string
  return { parsed: null, raw, isValid: false };
}

export function formatDimensions(dim: number[] | string | null | undefined): string {
  if (dim == null || dim === "") return "—";
  if (Array.isArray(dim)) {
    if (dim.length === 0) return "—";
    return dim.join(" × ");
  }
  return String(dim);
}

/* ─── Wheel Order Parser ──────────────────────────────────────── */

export function parseWheelOrder(val: unknown): string[] | undefined {
  if (!val) return undefined;
  if (Array.isArray(val)) {
    const filtered = val.map((v) => String(v).trim()).filter(Boolean);
    return filtered.length > 0 ? filtered : undefined;
  }
  const str = String(val).trim();
  if (!str) return undefined;

  // Clean brackets "[FL, FR, RL, RR]"
  const cleaned = str.replace(/^[\[\(]\s*/, "").replace(/\s*[\]\)]$/, "");
  // Split by comma, pipe, slash, semicolon, or whitespace
  const tokens = cleaned
    .split(/[,|\/;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (tokens.length === 1 && tokens[0].includes(" ")) {
    const subTokens = tokens[0].split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (subTokens.length > 1) return subTokens;
  }

  return tokens.length > 0 ? tokens : undefined;
}

/* ─── Column Matching Patterns ────────────────────────────────── */

const DIRECTION_PATTERNS = [
  /\b(?:io|i\/o)\s*(?:role|dir|direction|type)?\b/i,
  /\bdirection\b/i,
  /\bport\s*(?:kind|type|dir|direction)\b/i,
  /\bio\b/i,
  /\bport\s*class\b/i,
];

const BUS_PATTERNS = [
  /\bbus\s*(?:name|hierarchy|path|struct|structure)?\b/i,
  /\bparent\s*bus\b/i,
  /\bparent\s*(?:name|structure|group)\b/i,
  /\bmessage\s*name\b/i,
  /\bcontainer\b/i,
  /\bstructure\b/i,
  /\bgroup\b/i,
];

const NAME_PATTERNS = [
  /\b(?:signal|port|element|variable|param|inport|outport)\s*name\b/i,
  /\bsignal\b/i,
  /\bport\b/i,
  /\belement\b/i,
  /^\s*name\s*$/i,
  /\bidentifier\b/i,
];

const DATATYPE_PATTERNS = [
  /\bdata\s*type\b/i,
  /\bdatatype\b/i,
  /\bdtype\b/i,
  /\btype\b/i,
  /\bsimulink\s*type\b/i,
  /\bbase\s*type\b/i,
];

const DIMENSION_PATTERNS = [
  /\bdimensions?\b/i,
  /\bdim\b/i,
  /\bsize\b/i,
  /\bwidth\b/i,
  /\barray\s*size\b/i,
  /\bshape\b/i,
];

const SIGNAL_TYPE_PATTERNS = [
  /\bsignal\s*type\b/i,
  /\bsignaltype\b/i,
  /\bcomplexity\b/i,
  /\breal\s*\/\s*complex\b/i,
  /\bkind\b/i,
  /\bcategory\b/i,
];

const WHEEL_ORDER_PATTERNS = [
  /\bwheel\s*(?:order|ordering|indices|index|mapping|map)\b/i,
  /\bwheels?\b/i,
  /\belement\s*order\b/i,
  /\border\b/i,
];

const ENUM_CLASS_PATTERNS = [
  /^\s*if\s+enum\s*$/i,
  /\benum\s*(?:class|type|name|values?)?\b/i,
  /\benumeration\b/i,
];

const UNIT_PATTERNS = [
  /\bunits?\b/i,
  /\buom\b/i,
  /\beng(?:ineering)?\s*units?\b/i,
];

const DESCRIPTION_PATTERNS = [
  /\bdesc(?:ription)?\b/i,
  /\bcomments?\b/i,
  /\bdefinition\b/i,
  /\bdetails\b/i,
  /\bnotes?\b/i,
  /\bremarks?\b/i,
];

const MIN_PATTERNS = [
  /^\s*min(?:imum)?\b/i,
  /\blower\s*limit\b/i,
  /\bmin\s*val(?:ue)?\b/i,
];

const MAX_PATTERNS = [
  /^\s*max(?:imum)?\b/i,
  /\bupper\s*limit\b/i,
  /\bmax\s*val(?:ue)?\b/i,
];

const DEFAULT_PATTERNS = [
  /\bdef(?:ault)?\s*(?:val(?:ue)?)?\b/i,
  /\binit(?:ial)?\s*(?:val(?:ue)?)?\b/i,
  /\binitval\b/i,
  /\bstarting\s*value\b/i,
];

interface InterfaceColumnMap {
  direction: number;
  bus: number;
  name: number;
  datatype: number;
  dimension: number;
  signalType: number;
  wheelOrder: number;
  enumClass: number;
  unit: number;
  description: number;
  min: number;
  max: number;
  defaultVal: number;
  otherColumns: { index: number; header: string }[];
  headers: string[];
}

function matchHeader(header: string, patterns: RegExp[]): boolean {
  const h = header.trim();
  if (!h) return false;
  return patterns.some((p) => p.test(h));
}

function detectColumnMap(headerRow: unknown[]): InterfaceColumnMap {
  const headers = headerRow.map((h) => (h != null ? String(h).trim() : ""));

  const map: InterfaceColumnMap = {
    direction: -1,
    bus: -1,
    name: -1,
    datatype: -1,
    dimension: -1,
    signalType: -1,
    wheelOrder: -1,
    enumClass: -1,
    unit: -1,
    description: -1,
    min: -1,
    max: -1,
    defaultVal: -1,
    otherColumns: [],
    headers,
  };

  const assigned = new Set<number>();

  headers.forEach((h, i) => {
    if (!h) return;
    if (matchHeader(h, DIRECTION_PATTERNS) && map.direction === -1) {
      map.direction = i;
      assigned.add(i);
    } else if (matchHeader(h, BUS_PATTERNS) && map.bus === -1) {
      map.bus = i;
      assigned.add(i);
    } else if (matchHeader(h, NAME_PATTERNS) && map.name === -1) {
      map.name = i;
      assigned.add(i);
    } else if (matchHeader(h, DATATYPE_PATTERNS) && map.datatype === -1) {
      map.datatype = i;
      assigned.add(i);
    } else if (matchHeader(h, DIMENSION_PATTERNS) && map.dimension === -1) {
      map.dimension = i;
      assigned.add(i);
    } else if (matchHeader(h, SIGNAL_TYPE_PATTERNS) && map.signalType === -1) {
      map.signalType = i;
      assigned.add(i);
    } else if (matchHeader(h, WHEEL_ORDER_PATTERNS) && map.wheelOrder === -1) {
      map.wheelOrder = i;
      assigned.add(i);
    } else if (matchHeader(h, ENUM_CLASS_PATTERNS) && map.enumClass === -1) {
      map.enumClass = i;
      assigned.add(i);
    } else if (matchHeader(h, UNIT_PATTERNS) && map.unit === -1) {
      map.unit = i;
      assigned.add(i);
    } else if (matchHeader(h, DESCRIPTION_PATTERNS) && map.description === -1) {
      map.description = i;
      assigned.add(i);
    } else if (matchHeader(h, MIN_PATTERNS) && map.min === -1) {
      map.min = i;
      assigned.add(i);
    } else if (matchHeader(h, MAX_PATTERNS) && map.max === -1) {
      map.max = i;
      assigned.add(i);
    } else if (matchHeader(h, DEFAULT_PATTERNS) && map.defaultVal === -1) {
      map.defaultVal = i;
      assigned.add(i);
    }
  });

  // Collect all other unassigned columns into `otherColumns` so nothing is discarded
  headers.forEach((h, i) => {
    if (h && !assigned.has(i)) {
      map.otherColumns.push({ index: i, header: h });
    }
  });

  return map;
}

function scoreColumnMap(map: InterfaceColumnMap): number {
  let score = 0;
  if (map.name !== -1) score += 6;
  if (map.direction !== -1) score += 5;
  if (map.datatype !== -1) score += 3;
  if (map.bus !== -1) score += 3;
  if (map.dimension !== -1) score += 2;
  if (map.signalType !== -1) score += 2;
  if (map.wheelOrder !== -1) score += 2;
  return score;
}

function cellValue(row: unknown[], idx: number): string {
  if (idx < 0 || idx >= row.length) return "";
  const v = row[idx];
  return v == null ? "" : String(v).trim();
}

function parseDirection(
  rawRole: string,
  sheetName: string,
  currentSection: "Input" | "Output" | null
): "Input" | "Output" | "Internal" | null {
  const role = rawRole.trim().toLowerCase().replace(/[_/]+/g, " ");

  if (/^(in|input|inport|in port|inputs|rx)$/.test(role) || /\binport\b/.test(role) || /^in\b/.test(role)) {
    return "Input";
  }
  if (/^(out|output|outport|out port|outputs|tx)$/.test(role) || /\boutport\b/.test(role) || /^out\b/.test(role)) {
    return "Output";
  }
  if (/\b(internal|derived|intermediate|local|virtual)\b/.test(role)) {
    return "Internal";
  }

  // Check current section heading
  if (currentSection) return currentSection;

  // Check sheet name
  const s = sheetName.toLowerCase();
  if (s.includes("input") || s.includes("inport") || s === "in") return "Input";
  if (s.includes("output") || s.includes("outport") || s === "out") return "Output";

  return null;
}

/* ─── Hierarchical Bus Insertion ──────────────────────────────── */

/**
 * Inserts a signal into a nested bus hierarchy.
 * pathSegments: e.g. ["InputBus", "WheelData"]
 */
function insertIntoBusHierarchy(
  buses: InterfaceBus[],
  pathSegments: string[],
  signal: InterfaceSignal
) {
  if (pathSegments.length === 0) return;

  const topBusName = pathSegments[0].trim();
  let topBus = buses.find((b) => b.name.toLowerCase() === topBusName.toLowerCase());
  if (!topBus) {
    topBus = {
      id: generateId("bus"),
      name: topBusName,
      elements: [],
      metadata: {},
    };
    buses.push(topBus);
  }

  // If top-level bus only
  if (pathSegments.length === 1) {
    // Check if element with same name exists
    const existingIdx = topBus.elements.findIndex(
      (e) => e.name.toLowerCase() === signal.name.toLowerCase()
    );
    const busElement: InterfaceBusElement = {
      ...signal,
      id: signal.id || generateId("elem"),
    };
    if (existingIdx >= 0) {
      topBus.elements[existingIdx] = busElement;
    } else {
      topBus.elements.push(busElement);
    }
    return;
  }

  // Traverse / build nested elements
  let currentElements = topBus.elements;
  for (let i = 1; i < pathSegments.length; i++) {
    const subBusName = pathSegments[i].trim();
    let subBus = currentElements.find(
      (e) => e.is_bus && e.name.toLowerCase() === subBusName.toLowerCase()
    );
    if (!subBus) {
      subBus = {
        id: generateId("bus_elem"),
        name: subBusName,
        is_bus: true,
        elements: [],
        metadata: {},
      };
      currentElements.push(subBus);
    }
    if (!subBus.elements) subBus.elements = [];
    currentElements = subBus.elements;
  }

  // Insert the leaf signal into currentElements
  const existingIdx = currentElements.findIndex(
    (e) => !e.is_bus && e.name.toLowerCase() === signal.name.toLowerCase()
  );
  const busElement: InterfaceBusElement = {
    ...signal,
    id: signal.id || generateId("elem"),
  };
  if (existingIdx >= 0) {
    currentElements[existingIdx] = busElement;
  } else {
    currentElements.push(busElement);
  }
}

/* ─── Main Parser ─────────────────────────────────────────────── */

export function parseInterfaceWorkbook(arrayBuffer: ArrayBuffer | Uint8Array): ParseInterfaceResult {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const interfaceData: ModelInterface = createEmptyInterface();
  const warnings: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
    });
    if (!rows || rows.length < 1) continue;

    // Detect header row by testing candidate rows
    let headerRowIndex = 0;
    let colMap = detectColumnMap(rows[0] || []);
    let bestScore = scoreColumnMap(colMap);

    for (let r = 1; r < Math.min(rows.length, 15); r++) {
      const candidate = detectColumnMap(rows[r] || []);
      const score = scoreColumnMap(candidate);
      if (score > bestScore) {
        bestScore = score;
        headerRowIndex = r;
        colMap = candidate;
      }
    }

    // Section tracking for section-based layouts
    let currentSection: "Input" | "Output" | null = null;
    let currentActiveBus: string | null = null;

    // Check if sheet name indicates direction
    const lowerSheet = sheetName.toLowerCase();
    if (lowerSheet.includes("input") || lowerSheet.includes("inport")) {
      currentSection = "Input";
    } else if (lowerSheet.includes("output") || lowerSheet.includes("outport")) {
      currentSection = "Output";
    }

    // Process data rows
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const nonEmpties = row.filter((c) => c != null && String(c).trim() !== "");
      if (nonEmpties.length === 0) continue;

      const firstCell = String(row[0] || "").trim();

      // Check for Section Header row like "INPUT", "INPUT PORTS", "OUTPUT PORTS"
      if (nonEmpties.length <= 2) {
        const text = firstCell.toUpperCase();
        if (/^INPUTS?(\s+PORTS?)?$/.test(text) || /^INPORTS?$/.test(text)) {
          currentSection = "Input";
          currentActiveBus = null;
          continue;
        }
        if (/^OUTPUTS?(\s+PORTS?)?$/.test(text) || /^OUTPORTS?$/.test(text)) {
          currentSection = "Output";
          currentActiveBus = null;
          continue;
        }
        // Possible Bus Header row in hierarchical layout
        if (colMap.name === -1 || colMap.direction === -1) {
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(firstCell) && !firstCell.includes(" ")) {
            currentActiveBus = firstCell;
            continue;
          }
        }
      }

      // Extract raw values from row
      const rawDirection = cellValue(row, colMap.direction);
      let rawBus = cellValue(row, colMap.bus) || currentActiveBus || "";
      let rawName = cellValue(row, colMap.name);
      const rawDataType = cellValue(row, colMap.datatype);
      const rawDimension = colMap.dimension !== -1 ? row[colMap.dimension] : null;
      const rawSignalType = cellValue(row, colMap.signalType);
      const rawWheelOrder = colMap.wheelOrder !== -1 ? row[colMap.wheelOrder] : null;
      const rawEnumClass = cellValue(row, colMap.enumClass);
      const rawUnit = cellValue(row, colMap.unit);
      const rawDescription = cellValue(row, colMap.description);
      const rawMin = cellValue(row, colMap.min);
      const rawMax = cellValue(row, colMap.max);
      const rawDefault = cellValue(row, colMap.defaultVal);

      // Fallback for Name if Name column wasn't explicitly detected
      if (!rawName) {
        for (let c = 0; c < row.length; c++) {
          if (c === colMap.direction || c === colMap.datatype || c === colMap.dimension) continue;
          const val = cellValue(row, c);
          if (val && /^[A-Za-z_][A-Za-z0-9_]*$/.test(val) && !/^(input|output|internal|double|boolean|uint8)$/i.test(val)) {
            rawName = val;
            break;
          }
        }
      }

      if (!rawName) continue; // Skip rows without name

      // Determine Direction
      const direction = parseDirection(rawDirection, sheetName, currentSection);
      if (direction === "Internal") {
        continue; // Skip internal signals
      }

      const targetGroup = direction === "Output" ? interfaceData.outputs : interfaceData.inputs;

      // Handle dot notation in name, e.g. "InputBus.WheelData.Pressure"
      let busPathSegments: string[] = [];
      let finalSignalName = rawName.trim();

      if (rawName.includes(".") || rawName.includes("/")) {
        const parts = rawName.split(/[.\/]+/).map((s) => s.trim()).filter(Boolean);
        if (parts.length > 1) {
          finalSignalName = parts[parts.length - 1];
          busPathSegments = parts.slice(0, parts.length - 1);
        }
      }

      if (rawBus && busPathSegments.length === 0) {
        busPathSegments = rawBus.split(/[.\/]+/).map((s) => s.trim()).filter(Boolean);
      }

      // Parse Dimensions
      const dimResult = parseDimensionString(rawDimension);
      const dimensions = dimResult.isValid ? dimResult.parsed : (dimResult.raw || null);

      // Parse Wheel Order
      const wheelOrder = parseWheelOrder(rawWheelOrder);

      // Gather Metadata
      const metadata: Record<string, unknown> = {};
      if (rawUnit) metadata.unit = rawUnit;
      if (rawDescription) metadata.description = rawDescription;
      if (rawMin) metadata.min = isNaN(Number(rawMin)) ? rawMin : Number(rawMin);
      if (rawMax) metadata.max = isNaN(Number(rawMax)) ? rawMax : Number(rawMax);
      if (rawDefault) metadata.default = rawDefault;

      // Add other unmapped columns to metadata
      colMap.otherColumns.forEach(({ index, header }) => {
        const val = cellValue(row, index);
        if (val) {
          const cleanKey = header.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
          if (cleanKey && !(cleanKey in metadata)) {
            metadata[cleanKey] = val;
          }
        }
      });

      // Construct Signal Object
      const signal: InterfaceSignal = {
        id: generateId("sig"),
        name: finalSignalName,
        dimensions: dimensions,
        data_type: rawDataType || undefined,
        signal_type: rawSignalType ? rawSignalType.toLowerCase() : undefined,
        wheel_order: wheelOrder,
        enum_values: rawEnumClass || undefined,
        enum_class: rawEnumClass || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      };

      // Add to Bus Hierarchy or Top-Level Ports
      if (busPathSegments.length > 0) {
        insertIntoBusHierarchy(targetGroup.buses, busPathSegments, signal);
      } else {
        // Check for duplicate port
        const existingIdx = targetGroup.ports.findIndex(
          (p) => p.name.toLowerCase() === signal.name.toLowerCase()
        );
        if (existingIdx >= 0) {
          targetGroup.ports[existingIdx] = { ...signal, id: targetGroup.ports[existingIdx].id };
        } else {
          targetGroup.ports.push({ ...signal, id: signal.id || generateId("port") });
        }
      }
    }
  }

  // Count totals
  let totalInputs = interfaceData.inputs.ports.length;
  interfaceData.inputs.buses.forEach((b) => {
    totalInputs += countBusElements(b.elements);
  });

  let totalOutputs = interfaceData.outputs.ports.length;
  interfaceData.outputs.buses.forEach((b) => {
    totalOutputs += countBusElements(b.elements);
  });

  const totalBuses = interfaceData.inputs.buses.length + interfaceData.outputs.buses.length;

  if (totalInputs === 0 && totalOutputs === 0) {
    warnings.push(
      "No input or output signals could be identified. Ensure the Excel contains signal names and direction/bus columns."
    );
  }

  return {
    interfaceData,
    totalInputs,
    totalOutputs,
    totalBuses,
    warnings,
    sheets: wb.SheetNames,
  };
}

function countBusElements(elements: InterfaceBusElement[]): number {
  let count = 0;
  for (const elem of elements) {
    if (elem.is_bus && elem.elements) {
      count += countBusElements(elem.elements);
    } else {
      count += 1;
    }
  }
  return count;
}

/* ─── Clean Export JSON Generator ─────────────────────────────── */

export function cleanInterfaceForExport(modelInterface: ModelInterface): CleanModelInterface {
  function cleanSignal(sig: InterfaceSignal): CleanSignal {
    const clean: CleanSignal = {
      name: sig.name || "",
    };

    if (sig.dimensions !== undefined && sig.dimensions !== null) {
      clean.dimensions = sig.dimensions;
    }
    if (sig.data_type) {
      clean.data_type = sig.data_type;
    }
    if (sig.signal_type) {
      clean.signal_type = sig.signal_type;
    }
    if (sig.wheel_order && sig.wheel_order.length > 0) {
      clean.wheel_order = sig.wheel_order;
    }
    if (sig.enum_values) {
      clean.enum_values = sig.enum_values;
    }
    if (sig.enum_class) {
      clean.enum_class = sig.enum_class;
    }
    if (sig.metadata && Object.keys(sig.metadata).length > 0) {
      clean.metadata = sig.metadata;
    }

    return clean;
  }

  function cleanBusElement(elem: InterfaceBusElement): CleanBusElement {
    if (elem.is_bus && elem.elements) {
      const cleanBus: CleanBusElement = {
        name: elem.name || "",
        elements: elem.elements.map(cleanBusElement),
      };
      if (elem.metadata && Object.keys(elem.metadata).length > 0) {
        cleanBus.metadata = elem.metadata;
      }
      return cleanBus;
    }
    return cleanSignal(elem);
  }

  function cleanBus(bus: InterfaceBus): CleanBus {
    const clean: CleanBus = {
      name: bus.name || "",
      elements: (bus.elements || []).map(cleanBusElement),
    };
    if (bus.metadata && Object.keys(bus.metadata).length > 0) {
      clean.metadata = bus.metadata;
    }
    return clean;
  }

  return {
    inputs: {
      buses: (modelInterface.inputs?.buses || []).map(cleanBus),
      ports: (modelInterface.inputs?.ports || []).map(cleanSignal),
    },
    outputs: {
      buses: (modelInterface.outputs?.buses || []).map(cleanBus),
      ports: (modelInterface.outputs?.ports || []).map(cleanSignal),
    },
    ...(modelInterface.metadata ? { metadata: modelInterface.metadata } : {}),
  };
}

/* ─── Validation ──────────────────────────────────────────────── */

export function validateInterface(modelInterface: ModelInterface): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  const seenInputNames = new Set<string>();
  const seenOutputNames = new Set<string>();

  function validateSignal(
    sig: InterfaceSignal,
    path: string,
    seenNames: Set<string>
  ) {
    if (!sig.name || !sig.name.trim()) {
      errors.push({
        path,
        field: "name",
        message: "Signal name cannot be empty.",
        severity: "error",
      });
    } else {
      const lower = sig.name.trim().toLowerCase();
      if (seenNames.has(lower)) {
        errors.push({
          path,
          field: "name",
          message: `Duplicate name "${sig.name}" within the same scope.`,
          severity: "error",
        });
      } else {
        seenNames.add(lower);
      }
    }

    // Dimensions check
    if (sig.dimensions !== undefined && sig.dimensions !== null) {
      if (typeof sig.dimensions === "string") {
        const dimCheck = parseDimensionString(sig.dimensions);
        if (!dimCheck.isValid) {
          warnings.push({
            path,
            field: "dimensions",
            message: `Unresolved dimensions "${sig.dimensions}". Expected e.g. [1, 4] or 1x4.`,
            severity: "warning",
          });
        }
      } else if (Array.isArray(sig.dimensions)) {
        if (sig.dimensions.some((d) => !Number.isFinite(d) || d <= 0)) {
          errors.push({
            path,
            field: "dimensions",
            message: `Invalid dimension array ${JSON.stringify(sig.dimensions)}. Dimensions must be positive numbers.`,
            severity: "error",
          });
        }
      }
    } else {
      warnings.push({
        path,
        field: "dimensions",
        message: `Missing dimensions for "${sig.name || "unnamed"}".`,
        severity: "warning",
      });
    }

    // Data type check
    if (!sig.data_type || !sig.data_type.trim()) {
      warnings.push({
        path,
        field: "data_type",
        message: `Missing data type for "${sig.name || "unnamed"}".`,
        severity: "warning",
      });
    }

    // Signal type check
    if (!sig.signal_type || !sig.signal_type.trim()) {
      warnings.push({
        path,
        field: "signal_type",
        message: `Missing signal type for "${sig.name || "unnamed"}".`,
        severity: "warning",
      });
    }
  }

  function validateBusElements(
    elements: InterfaceBusElement[],
    busPath: string,
    seenElemNames: Set<string>
  ) {
    elements.forEach((elem, idx) => {
      const elemPath = `${busPath}.elements[${idx}]`;
      if (elem.is_bus) {
        if (!elem.name || !elem.name.trim()) {
          errors.push({
            path: elemPath,
            field: "name",
            message: "Nested bus name cannot be empty.",
            severity: "error",
          });
        }
        const nestedSeen = new Set<string>();
        validateBusElements(elem.elements || [], `${elemPath} (${elem.name || "unnamed"})`, nestedSeen);
      } else {
        validateSignal(elem, `${elemPath} (${elem.name || "unnamed"})`, seenElemNames);
      }
    });
  }

  // Validate Inputs
  const inputBusNames = new Set<string>();
  modelInterface.inputs?.buses?.forEach((bus, bIdx) => {
    const busPath = `inputs.buses[${bIdx}] (${bus.name || "unnamed"})`;
    if (!bus.name || !bus.name.trim()) {
      errors.push({
        path: busPath,
        field: "name",
        message: "Bus name cannot be empty.",
        severity: "error",
      });
    } else {
      const lower = bus.name.trim().toLowerCase();
      if (inputBusNames.has(lower)) {
        errors.push({
          path: busPath,
          field: "name",
          message: `Duplicate bus name "${bus.name}" in inputs.`,
          severity: "error",
        });
      } else {
        inputBusNames.add(lower);
      }
    }
    const busSeen = new Set<string>();
    validateBusElements(bus.elements || [], busPath, busSeen);
  });

  modelInterface.inputs?.ports?.forEach((port, pIdx) => {
    validateSignal(port, `inputs.ports[${pIdx}] (${port.name || "unnamed"})`, seenInputNames);
  });

  // Validate Outputs
  const outputBusNames = new Set<string>();
  modelInterface.outputs?.buses?.forEach((bus, bIdx) => {
    const busPath = `outputs.buses[${bIdx}] (${bus.name || "unnamed"})`;
    if (!bus.name || !bus.name.trim()) {
      errors.push({
        path: busPath,
        field: "name",
        message: "Bus name cannot be empty.",
        severity: "error",
      });
    } else {
      const lower = bus.name.trim().toLowerCase();
      if (outputBusNames.has(lower)) {
        errors.push({
          path: busPath,
          field: "name",
          message: `Duplicate bus name "${bus.name}" in outputs.`,
          severity: "error",
        });
      } else {
        outputBusNames.add(lower);
      }
    }
    const busSeen = new Set<string>();
    validateBusElements(bus.elements || [], busPath, busSeen);
  });

  modelInterface.outputs?.ports?.forEach((port, pIdx) => {
    validateSignal(port, `outputs.ports[${pIdx}] (${port.name || "unnamed"})`, seenOutputNames);
  });

  return {
    isValid: errors.length === 0,
    hasErrors: errors.length > 0,
    errors,
    warnings,
  };
}
