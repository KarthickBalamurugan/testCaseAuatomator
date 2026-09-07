/**
 * Requirements PDF / Document Parser Engine
 * Handles DOORS / Polarion style Field-Value card layouts for:
 * - Normal Requirements (Functional / Software)
 * - Interface Requirements (RTE / Client-Server)
 * - Test Requirements (Configurable field lists)
 */

export type DocType = "normal" | "interface" | "test";

export interface GlyphMapping {
  id: string;
  code: string; // Hex code without 'U+', e.g. "EE55"
  rep: string;  // Replacement character, e.g. "-"
}

export const DEFAULT_GLYPH_MAP: GlyphMapping[] = [
  { id: "1", code: "EE4E", rep: "(" },
  { id: "2", code: "EE4F", rep: ")" },
  { id: "3", code: "EE52", rep: "[" },
  { id: "4", code: "EE53", rep: "]" },
  { id: "5", code: "EE55", rep: "-" },
];

export const DEFAULT_TEST_FIELDS = [
  "ID",
  "UUID",
  "Title",
  "Type",
  "Requirement Reference",
  "Test Objective",
  "Preconditions",
  "Test Steps",
  "Test Data",
  "Expected Result",
  "Pass/Fail Criteria",
];

export interface RequirementRow {
  category: string;
  req_id: string;
  uuid?: string;
  title?: string;
  type?: string;
  description?: string;
  rationale?: string;
  port_kind?: string;
  direction?: string;
  communication_partner?: string;
  data_category?: string;
  physical_range?: string;
  clipping_range?: string;
  inactive_value?: string;
  min_resolution?: string;
  units?: string;
  timing?: string;
  detection?: string;
  recommendation?: string;
  function?: string;
  return_value?: string;
  [key: string]: string | undefined;
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyGlyphMap(text: string, glyphs: GlyphMapping[]): string {
  let out = text;
  for (const g of glyphs) {
    const code = g.code.trim().toUpperCase();
    if (code) {
      try {
        const char = String.fromCharCode(parseInt(code, 16));
        out = out.split(char).join(g.rep);
      } catch {
        // ignore invalid hex
      }
    }
  }
  return out;
}

export function scanUnmappedGlyphs(
  text: string,
  glyphs: GlyphMapping[]
): Array<{ codeHex: string; context: string }> {
  const known = new Set(
    glyphs
      .map((g) => {
        try {
          return parseInt(g.code.trim(), 16);
        } catch {
          return null;
        }
      })
      .filter((v): v is number => v !== null && !isNaN(v))
  );

  const found = new Map<number, string>();
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i);
    if (code && code >= 0xe000 && code <= 0xf8ff && !known.has(code)) {
      if (!found.has(code)) {
        const start = Math.max(0, i - 15);
        const end = Math.min(text.length, i + 15);
        const snippet = text.substring(start, end).replace(/\s+/g, " ");
        found.set(code, snippet);
      }
    }
  }

  return Array.from(found.entries()).map(([code, snippet]) => ({
    codeHex: code.toString(16).toUpperCase(),
    context: snippet,
  }));
}

const HEADING_RE = /^\s*(\d+(?:\.\d+)*)\s+(.+?)\s*$/;

export function headingTitle(line: string): string | null {
  const m = line.match(HEADING_RE);
  if (!m) return null;
  const title = m[2];
  if ((title.match(/\./g) || []).length >= 2) return null; // ToC dot-leader line
  if (title.trim().length <= 2) return null;
  return title.trim();
}

export function cleanNoise(text: string): string {
  return text
    .replace(/\f/g, "\n")
    .split("\n")
    .map((l) => {
      const s = l.trim().replace(/\s+/g, " ");
      if (/^\d+$/.test(s)) return null;
      if (
        [
          "Continued on next page",
          "(Continued)",
          "Field Value",
          "Field",
          "Value",
          "",
        ].includes(s)
      )
        return null;
      return l;
    })
    .filter((l): l is string => l !== null)
    .join("\n");
}

export function detectSections(text: string): Array<{ pos: number; name: string }> {
  const sections: Array<{ pos: number; name: string }> = [];
  const lines = text.split("\n");
  let pos = 0;
  for (const line of lines) {
    const t = headingTitle(line);
    if (t) sections.push({ pos, name: t });
    pos += line.length + 1;
  }
  return sections;
}

export function sectionFor(
  sections: Array<{ pos: number; name: string }>,
  pos: number
): string {
  let cat = "";
  for (const s of sections) {
    if (s.pos <= pos) cat = s.name;
    else break;
  }
  return cat;
}

export function stripHeadingLines(block: string): string {
  return block
    .split("\n")
    .filter((l) => !headingTitle(l))
    .join("\n");
}

export function grabSimpleField(block: string, label: string): string {
  const m = block.match(new RegExp(escapeRe(label) + "\\s+(.+)"));
  return m ? m[1].trim() : "";
}

export function parseSequentialLongFields(
  tail: string,
  labels: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  labels.forEach((l) => (out[l] = ""));
  if (labels.length === 0) return out;

  let remaining = tail.split(labels[0]).join(" ");
  for (let i = 1; i < labels.length; i++) {
    const idx = remaining.indexOf(labels[i]);
    if (idx === -1) {
      out[labels[i - 1]] += remaining;
      remaining = "";
      continue;
    }
    const periodBefore = remaining.lastIndexOf(".", idx);
    const splitAt = periodBefore !== -1 ? periodBefore + 1 : idx;
    out[labels[i - 1]] += remaining.substring(0, splitAt);
    remaining = remaining.substring(splitAt).split(labels[i]).join(" ");
  }
  out[labels[labels.length - 1]] += remaining;
  for (const l of labels) {
    out[l] = out[l].replace(/\s*\n\s*/g, " ").replace(/[ \t]+/g, " ").trim();
  }
  return out;
}

export function splitBlocks(text: string) {
  const re = /Requirement\s+(\S+)\s*[—\-:]\s*(.+)/g;
  return [...text.matchAll(re)];
}

/* ---------------------------------------------------------------------
   PARSER: NORMAL (functional / software requirement cards)
--------------------------------------------------------------------- */
export function parseNormal(fullText: string): RequirementRow[] {
  const text = cleanNoise(fullText);
  const sections = detectSections(text);
  const matches = splitBlocks(text);
  const out: RequirementRow[] = [];

  matches.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    let block = text.substring(start, end);
    const category = sectionFor(sections, m.index);
    const uuid = grabSimpleField(block, "UUID");
    const title = grabSimpleField(block, "Title") || m[2].trim();
    const type = grabSimpleField(block, "Type");

    const typeIdx = block.search(/Type\s+.+/);
    let tail =
      typeIdx !== -1
        ? block.substring(
            block.indexOf(block.match(/Type\s+.+/)![0]) +
              block.match(/Type\s+.+/)![0].length
          )
        : block;
    tail = stripHeadingLines(tail);

    const longFields = parseSequentialLongFields(tail, ["Description", "Rationale"]);

    out.push({
      category,
      req_id: m[1],
      uuid,
      title,
      type,
      description: longFields["Description"] || "",
      rationale: longFields["Rationale"] || "",
    });
  });

  return out;
}

/* ---------------------------------------------------------------------
   PARSER: INTERFACE (RTE / client-server interface cards)
--------------------------------------------------------------------- */
export function parseInterface(fullText: string): RequirementRow[] {
  const text = cleanNoise(fullText);
  const sections = detectSections(text);
  const matches = splitBlocks(text);
  const subfieldKeys = [
    "data_category",
    "physical range",
    "clipping range",
    "inactive value",
    "incative value",
    "minimum resolution",
    "units",
    "timing",
    "detection",
    "recommendation",
    "function",
    "return value",
  ];

  const out: RequirementRow[] = [];
  matches.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    let block = text.substring(start, end);
    const category = sectionFor(sections, m.index);

    const uuid = grabSimpleField(block, "UUID");
    const title = grabSimpleField(block, "Title") || m[2].trim();
    const type = grabSimpleField(block, "Type");
    const portKind = grabSimpleField(block, "Port Kind");
    const direction = grabSimpleField(block, "Direction");
    const commM = block.match(/Communication\s*\n\s*(.+?)\s*\n\s*Partner/);
    const commPartner = commM ? commM[1].trim() : "";

    let descStart = 0;
    for (const lbl of ["Partner", "Direction", "Type", "Port Kind"]) {
      const mm = block.match(new RegExp(lbl + ".*"));
      if (mm) descStart = Math.max(descStart, block.indexOf(mm[0]) + mm[0].length);
    }
    let descBlock = stripHeadingLines(block.substring(descStart));
    descBlock = descBlock.replace(/\bDescription\b/g, " ").replace(/[ \t]+/g, " ");

    const keyAlt = subfieldKeys.map(escapeRe).join("|");
    const firstKeyM = descBlock.match(new RegExp("(" + keyAlt + ")\\s*:"));
    let freeText = firstKeyM ? descBlock.substring(0, firstKeyM.index) : descBlock;
    freeText = freeText.replace(/\s*\n\s*/g, " ").trim();

    const sub: Record<string, string> = {};
    const subRe = new RegExp(
      "(" + keyAlt + ")\\s*:\\s*(.*?)(?=(?:" + keyAlt + ")\\s*:|$)",
      "gis"
    );
    let sm: RegExpExecArray | null;
    while ((sm = subRe.exec(descBlock)) !== null) {
      const key = sm[1].trim().toLowerCase().replace("incative value", "inactive value");
      sub[key] = sm[2].replace(/\s*\n\s*/g, " ").trim();
    }

    out.push({
      category,
      req_id: m[1],
      uuid,
      title,
      type,
      port_kind: portKind,
      direction,
      communication_partner: commPartner,
      description: freeText,
      data_category: sub["data_category"] || "",
      physical_range: sub["physical range"] || "",
      clipping_range: sub["clipping range"] || "",
      inactive_value: sub["inactive value"] || "",
      min_resolution: sub["minimum resolution"] || "",
      units: sub["units"] || "",
      timing: sub["timing"] || "",
      detection: sub["detection"] || "",
      recommendation: sub["recommendation"] || "",
      function: sub["function"] || "",
      return_value: sub["return value"] || "",
    });
  });

  return out;
}

/* ---------------------------------------------------------------------
   PARSER: TEST (configurable field list)
--------------------------------------------------------------------- */
export function parseTest(fullText: string, labels: string[]): RequirementRow[] {
  const text = cleanNoise(fullText);
  const sections = detectSections(text);
  const matches = splitBlocks(text);
  const simpleLabels = labels.filter((l) => ["ID", "UUID", "Title", "Type"].includes(l));
  const longLabels = labels.filter((l) => !simpleLabels.includes(l));

  const out: RequirementRow[] = [];
  matches.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    let block = text.substring(start, end);
    const category = sectionFor(sections, m.index);

    const rec: RequirementRow = { category, req_id: m[1] };
    simpleLabels.forEach((l) => {
      rec[l] = grabSimpleField(block, l) || (l === "Title" ? m[2].trim() : "");
    });

    let tailStart = 0;
    simpleLabels.forEach((l) => {
      const mm = block.match(new RegExp(escapeRe(l) + "\\s+.*"));
      if (mm) tailStart = Math.max(tailStart, block.indexOf(mm[0]) + mm[0].length);
    });
    let tail = stripHeadingLines(block.substring(tailStart));
    const longVals = parseSequentialLongFields(
      tail,
      longLabels.length ? longLabels : ["Description"]
    );
    Object.assign(rec, longVals);
    out.push(rec);
  });

  return out;
}

export const PRETTY_COLUMN_MAP: Record<string, string> = {
  category: "Category",
  req_id: "Req ID",
  uuid: "UUID",
  title: "Title",
  type: "Type",
  port_kind: "Port Kind",
  direction: "Direction",
  communication_partner: "Comm Partner",
  description: "Description",
  rationale: "Rationale",
  data_category: "Data Category",
  physical_range: "Physical Range",
  clipping_range: "Clipping Range",
  inactive_value: "Inactive Value",
  min_resolution: "Min Resolution",
  units: "Units",
  timing: "Timing",
  detection: "Detection",
  recommendation: "Recommendation",
  function: "Function",
  return_value: "Return Value",
};
