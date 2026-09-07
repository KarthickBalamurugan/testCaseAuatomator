"use client";

import { useState, useRef, ChangeEvent, DragEvent, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  FileText,
  X,
  Loader2,
  ScanText,
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  Download,
  Search,
  FileType,
  BookOpen,
  Settings2,
  Plus,
  Trash2,
  Table as TableIcon,
  Sparkles,
  ArrowRight,
  Filter,
  FileSpreadsheet,
  FileCode,
  Layers,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import Navbar from "../components/Navbar";
import {
  DocType,
  GlyphMapping,
  RequirementRow,
  DEFAULT_GLYPH_MAP,
  DEFAULT_TEST_FIELDS,
  applyGlyphMap,
  scanUnmappedGlyphs,
  parseNormal,
  parseInterface,
  parseTest,
  PRETTY_COLUMN_MAP,
} from "@/lib/requirementParser";

export default function ParserPage() {
  // Step 1: Configuration
  const [docType, setDocType] = useState<DocType>("normal");
  const [testFieldLabels, setTestFieldLabels] = useState(
    DEFAULT_TEST_FIELDS.join("\n")
  );
  const [glyphs, setGlyphs] = useState<GlyphMapping[]>(DEFAULT_GLYPH_MAP);
  const [showGlyphSettings, setShowGlyphSettings] = useState(false);
  const [glyphScanResult, setGlyphScanResult] = useState<
    Array<{ codeHex: string; context: string }> | null
  >(null);
  const [isScanningGlyphs, setIsScanningGlyphs] = useState(false);

  // Step 2: Upload & Parsing State
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState("");
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseStatus, setParseStatus] = useState("");
  const [parseError, setParseError] = useState("");
  const [rawText, setRawText] = useState("");

  // Step 3: Review & Metadata
  const [rows, setRows] = useState<RequirementRow[]>([]);
  const [currentHeaders, setCurrentHeaders] = useState<string[]>([]);
  const [docRef, setDocRef] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterNeedsReview, setFilterNeedsReview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportSuccess, setExportSuccess] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  // Required keys to determine completeness
  const requiredKeys = useMemo(() => {
    if (docType === "interface") return ["req_id", "title", "description"];
    if (docType === "test") return ["req_id"];
    return ["req_id", "title", "description"];
  }, [docType]);

  // Handle Glyph Mapping edits
  const handleAddGlyph = () => {
    setGlyphs((prev) => [
      ...prev,
      { id: String(Date.now()), code: "", rep: "" },
    ]);
  };

  const handleUpdateGlyph = (id: string, field: "code" | "rep", val: string) => {
    setGlyphs((prev) =>
      prev.map((g) => (g.id === id ? { ...g, [field]: val } : g))
    );
  };

  const handleRemoveGlyph = (id: string) => {
    setGlyphs((prev) => prev.filter((g) => g.id !== id));
  };

  // Scan unmapped glyphs in uploaded file
  const handleScanGlyphs = async () => {
    if (!uploadedFile) {
      setParseError("Please select a PDF file first to scan.");
      return;
    }
    setIsScanningGlyphs(true);
    setGlyphScanResult(null);

    try {
      let text = rawText;
      if (!text) {
        text = await extractRawText(uploadedFile, false);
      }
      const unmapped = scanUnmappedGlyphs(text, glyphs);
      setGlyphScanResult(unmapped);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "Failed to scan PDF glyphs."
      );
    } finally {
      setIsScanningGlyphs(false);
    }
  };

  // Extract text from PDF or Image/Text
  const extractRawText = async (file: File, applyMap = true): Promise<string> => {
    const isPdf =
      file.type === "application/pdf" || /\.pdf$/i.test(file.name);

    if (isPdf) {
      try {
        const buf = await file.arrayBuffer();
        const pdfjsLib = await import("pdfjs-dist");
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        }
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(buf),
        });
        const pdf = await loadingTask.promise;
        const lineTextParts: string[] = [];

        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          const items = content.items
            .filter((it: any) => typeof it.str === "string")
            .map((it: any) => ({
              str: it.str,
              x: it.transform[4],
              y: it.transform[5],
            }));

          const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
          let curY: number | null = null;
          let curLine: Array<{ str: string; x: number; y: number }> = [];
          const lines: Array<Array<{ str: string; x: number; y: number }>> = [];

          for (const it of sorted) {
            if (curY === null || Math.abs(it.y - curY) > 3) {
              if (curLine.length) lines.push(curLine);
              curLine = [it];
              curY = it.y;
            } else {
              curLine.push(it);
            }
          }
          if (curLine.length) lines.push(curLine);

          for (const line of lines) {
            line.sort((a, b) => a.x - b.x);
            lineTextParts.push(
              line
                .map((it) => it.str)
                .join(" ")
                .replace(/\s+/g, " ")
                .trim()
            );
          }
          lineTextParts.push("\f");
        }

        let fullText = lineTextParts.join("\n");
        if (applyMap) {
          fullText = applyGlyphMap(fullText, glyphs);
        }
        return fullText;
      } catch (pdfJsErr) {
        console.warn("Client-side PDF.js fallback to API route:", pdfJsErr);
        // Fallback to server API if browser worker is blocked
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/parse-document", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to extract PDF text.");
        }
        let fullText = data.text || "";
        if (applyMap) {
          fullText = applyGlyphMap(fullText, glyphs);
        }
        return fullText;
      }
    } else {
      // Image or Plain text via server API
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/parse-document", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to parse uploaded document.");
      }
      let fullText = data.text || "";
      if (applyMap) {
        fullText = applyGlyphMap(fullText, glyphs);
      }
      return fullText;
    }
  };

  const handleSelectFile = (file?: File) => {
    if (!file) return;
    setUploadedFile(file);
    setFileName(file.name);
    setFileSize(formatBytes(file.size));
    setParseError("");
    setExportSuccess("");
    setGlyphScanResult(null);
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleSelectFile(e.target.files?.[0]);
  };

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    handleSelectFile(e.dataTransfer.files?.[0]);
  };

  const clearAll = () => {
    setUploadedFile(null);
    setFileName("");
    setFileSize("");
    setRows([]);
    setCurrentHeaders([]);
    setRawText("");
    setParseError("");
    setExportSuccess("");
    setGlyphScanResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Main Parse Execution
  const handleParse = async () => {
    if (!uploadedFile) return;

    setIsParsing(true);
    setParseError("");
    setExportSuccess("");
    setParseStatus("Extracting structured layout from document...");

    try {
      const fullText = await extractRawText(uploadedFile, true);
      setRawText(fullText);

      setParseStatus("Parsing requirement blocks & fields...");

      let parsedRows: RequirementRow[] = [];
      let headers: string[] = [];

      if (docType === "interface") {
        parsedRows = parseInterface(fullText);
        headers = [
          "category",
          "req_id",
          "uuid",
          "title",
          "type",
          "port_kind",
          "direction",
          "communication_partner",
          "description",
          "data_category",
          "physical_range",
          "clipping_range",
          "inactive_value",
          "min_resolution",
          "units",
          "timing",
          "detection",
          "recommendation",
          "function",
          "return_value",
        ];
      } else if (docType === "test") {
        const labels = testFieldLabels
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        parsedRows = parseTest(fullText, labels);
        headers = ["category", "req_id", ...labels.filter((l) => l !== "ID")];
      } else {
        // normal
        parsedRows = parseNormal(fullText);
        headers = [
          "category",
          "req_id",
          "uuid",
          "title",
          "type",
          "description",
          "rationale",
        ];
      }

      if (parsedRows.length === 0) {
        throw new Error(
          'No requirements detected. Verify that the document contains "Requirement <ID> — <Title>" cards, or check the special-character mapping.'
        );
      }

      setRows(parsedRows);
      setCurrentHeaders(headers);

      // Auto-detect Document ID if not set
      const docIdMatch = fullText.match(/Document ID\s+(\S[\w\-\/.]*)/i);
      if (docIdMatch && !docRef) {
        setDocRef(docIdMatch[1]);
      }

      setParseStatus(`Successfully parsed ${parsedRows.length} requirements!`);
    } catch (err) {
      console.error(err);
      setParseError(
        err instanceof Error ? err.message : "An error occurred during parsing."
      );
    } finally {
      setIsParsing(false);
    }
  };

  // Table Cell Editing
  const handleCellChange = (rowIndex: number, key: string, value: string) => {
    setRows((prev) => {
      const updated = [...prev];
      updated[rowIndex] = { ...updated[rowIndex], [key]: value };
      return updated;
    });
  };

  const handleDeleteRow = (rowIndex: number) => {
    setRows((prev) => prev.filter((_, idx) => idx !== rowIndex));
  };

  const handleAddRow = () => {
    const newRow: RequirementRow = {
      category: "General",
      req_id: `REQ-${rows.length + 1}`,
      title: "New Requirement",
      description: "",
    };
    setRows((prev) => [newRow, ...prev]);
  };

  // Filtered rows for the review table
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const isMissing = requiredKeys.some(
        (k) => !String(row[k] || "").trim()
      );
      if (filterNeedsReview && !isMissing) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return Object.values(row).some((val) =>
        String(val || "").toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery, filterNeedsReview, requiredKeys]);

  const incompleteCount = useMemo(() => {
    return rows.filter((r) =>
      requiredKeys.some((k) => !String(r[k] || "").trim())
    ).length;
  }, [rows, requiredKeys]);

  // Export to Excel (.xlsx)
  const handleExportExcel = () => {
    if (rows.length === 0) return;
    const cleanDocRef = docRef.trim();
    const cleanModule = moduleName.trim();

    const headers = currentHeaders
      .map((k) => PRETTY_COLUMN_MAP[k] || k)
      .concat(["Module", "Doc Ref"]);

    const dataRows = rows.map((r) =>
      currentHeaders
        .map((k) => r[k] || "")
        .concat([cleanModule, cleanDocRef])
    );

    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws["!cols"] = headers.map((h) => ({
      wch: Math.min(Math.max(h.length + 4, 14), 45),
    }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "REQUIREMENTS");

    const safeName = (cleanDocRef || "requirements").replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    );
    const fileNameOut = `${safeName}_traceability.xlsx`;
    XLSX.writeFile(wb, fileNameOut);

    setExportSuccess(`Exported ${dataRows.length} rows to ${fileNameOut}`);
    setTimeout(() => setExportSuccess(""), 4000);
  };

  // Export as JSON
  const handleExportJson = () => {
    if (rows.length === 0) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            docRef,
            module: moduleName,
            total: rows.length,
            requirements: rows,
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(docRef || "requirements").replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Copy as Markdown table
  const handleCopyMarkdown = async () => {
    if (rows.length === 0) return;
    const headers = currentHeaders.map((k) => PRETTY_COLUMN_MAP[k] || k);
    let md = `| ${headers.join(" | ")} |\n`;
    md += `| ${headers.map(() => "---").join(" | ")} |\n`;
    rows.forEach((r) => {
      const vals = currentHeaders.map((k) =>
        String(r[k] || "").replace(/\n/g, " ")
      );
      md += `| ${vals.join(" | ")} |\n`;
    });

    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0f19] text-slate-100 selection:bg-blue-600 selection:text-white">
      <Navbar />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {/* Page Header */}
        <div className="mb-6 flex flex-col justify-between gap-4 border-b border-slate-800/80 pb-5 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2 text-blue-400">
              <ScanText className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">
                Specification Parser
              </span>
            </div>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">
              Requirement &amp; Document Extractor
            </h1>
            <p className="mt-1 text-xs text-slate-400">
              Extract, review, and export structured requirements to Excel and JSON.
            </p>
          </div>

          {/* Quick Profile Selector */}
          <div className="flex rounded-xl border border-slate-800 bg-slate-900/80 p-1">
            <button
              type="button"
              onClick={() => setDocType("normal")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                docType === "normal"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Standard
            </button>
            <button
              type="button"
              onClick={() => setDocType("interface")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                docType === "interface"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Interface
            </button>
            <button
              type="button"
              onClick={() => setDocType("test")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                docType === "test"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Test Specs
            </button>
          </div>
        </div>

        {/* Test Spec Field Customizer */}
        {docType === "test" && (
          <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <span className="mb-2 block text-xs font-medium text-slate-300">
              Custom Field Labels (one per line)
            </span>
            <textarea
              value={testFieldLabels}
              onChange={(e) => setTestFieldLabels(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-700/80 bg-slate-950 p-2.5 font-mono text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        )}

        {/* Upload & Parse Card */}
        <section className="mb-6 rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 shadow-sm">
          {/* Dropzone */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={handleDrop}
            className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed py-8 px-4 text-center transition-all ${
              isDraggingOver
                ? "border-blue-500 bg-blue-950/20"
                : "border-slate-700/80 bg-slate-950/40 hover:border-slate-600 hover:bg-slate-950/70"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*,.txt"
              className="hidden"
              onChange={handleInputChange}
            />
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/10 text-blue-400 border border-blue-500/20">
              <Upload className="h-5 w-5" />
            </div>
            <p className="text-xs font-medium text-slate-200">
              {isDraggingOver
                ? "Drop document here"
                : fileName
                ? fileName
                : "Drop PDF specification or image here, or click to browse"}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {fileName
                ? `${fileSize} · Ready to parse`
                : "Supports PDF and scanned image files"}
            </p>
          </label>

          {/* Action Row */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleParse}
                disabled={!uploadedFile || isParsing}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isParsing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Processing…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Extract Requirements</span>
                  </>
                )}
              </button>

              {fileName && (
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={isParsing}
                  className="rounded-lg border border-slate-700/80 bg-slate-800/80 px-3 py-2 text-xs text-slate-300 transition hover:bg-slate-700 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Character map toggle */}
            <button
              type="button"
              onClick={() => setShowGlyphSettings(!showGlyphSettings)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-400 transition"
            >
              <SlidersHorizontal className="h-3 w-3" />
              <span>Character Mapping ({glyphs.length})</span>
              {showGlyphSettings ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          </div>

          {/* Status feedback */}
          {parseStatus && !parseError && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
              <span>{parseStatus}</span>
            </div>
          )}

          {/* Parse error */}
          {parseError && (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-red-900/60 bg-red-950/30 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p className="text-xs text-red-300">{parseError}</p>
            </div>
          )}

          {/* Character Mapping Drawer */}
          {showGlyphSettings && (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="mb-3">
                <h3 className="text-xs font-semibold text-slate-200">
                  Unicode Character Mapping
                </h3>
                <p className="text-[11px] text-slate-400">
                  Map custom private-use Unicode codes to standard ASCII characters.
                </p>
              </div>

              <div className="space-y-1.5 mb-3 max-h-40 overflow-auto">
                {glyphs.map((g) => (
                  <div key={g.id} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-slate-500">U+</span>
                    <input
                      type="text"
                      placeholder="EE55"
                      value={g.code}
                      onChange={(e) =>
                        handleUpdateGlyph(g.id, "code", e.target.value)
                      }
                      className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100 uppercase"
                    />
                    <span className="text-slate-500">&rarr;</span>
                    <input
                      type="text"
                      placeholder="-"
                      value={g.rep}
                      onChange={(e) =>
                        handleUpdateGlyph(g.id, "rep", e.target.value)
                      }
                      className="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-center text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveGlyph(g.id)}
                      className="rounded p-1 text-slate-500 hover:text-red-400"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleAddGlyph}
                  className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                >
                  <Plus className="h-3 w-3" /> Add
                </button>

                <button
                  type="button"
                  onClick={handleScanGlyphs}
                  disabled={!uploadedFile || isScanningGlyphs}
                  className="flex items-center gap-1 rounded border border-blue-800/60 bg-blue-950/40 px-2.5 py-1 text-xs text-blue-300 hover:bg-blue-900/60 disabled:opacity-40"
                >
                  {isScanningGlyphs ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Search className="h-3 w-3" />
                  )}
                  Scan Document for Unmapped Glyphs
                </button>
              </div>

              {glyphScanResult && (
                <div className="mt-3 rounded border border-slate-800 bg-slate-900 p-2.5 text-xs">
                  {glyphScanResult.length === 0 ? (
                    <p className="text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      No unmapped private-use codes found.
                    </p>
                  ) : (
                    <div>
                      <p className="font-semibold text-amber-400 mb-1">
                        Found {glyphScanResult.length} unmapped code(s):
                      </p>
                      <div className="space-y-1 font-mono text-[11px] text-slate-300">
                        {glyphScanResult.map((u, i) => (
                          <div key={i}>
                            <span className="text-blue-400">U+{u.codeHex}</span> near &ldquo;…{u.context}…&rdquo;
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Results & Table Review */}
        {rows.length > 0 && (
          <section className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 shadow-lg">
            {/* Header & Actions */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Extracted Requirements ({rows.length})
                </h2>
                <p className="text-xs text-slate-400">
                  Click any cell to edit inline.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 active:scale-95"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>Export Excel</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportJson}
                  className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700 active:scale-95"
                >
                  <FileCode className="h-3 w-3 text-blue-400" />
                  <span>JSON</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyMarkdown}
                  className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700 active:scale-95"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 text-slate-400" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Doc Ref & Module Inputs */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-4">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Document Reference
                </label>
                <input
                  type="text"
                  placeholder="e.g. DOC-REQ-001"
                  value={docRef}
                  onChange={(e) => setDocRef(e.target.value)}
                  className="w-full rounded-lg border border-slate-700/80 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Module Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. ESC_Controller"
                  value={moduleName}
                  onChange={(e) => setModuleName(e.target.value)}
                  className="w-full rounded-lg border border-slate-700/80 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Table Filter Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3 rounded-lg border border-slate-800/80 bg-slate-950/40 p-2.5">
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search table..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-md border border-slate-700/80 bg-slate-900 py-1 pl-8 pr-2.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFilterNeedsReview(!filterNeedsReview)}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition ${
                    filterNeedsReview
                      ? "border-amber-500 bg-amber-500/20 text-amber-300"
                      : incompleteCount > 0
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                      : "border-slate-800 bg-slate-900 text-slate-400"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      incompleteCount > 0 ? "bg-amber-400" : "bg-slate-500"
                    }`}
                  />
                  {incompleteCount} Needs Review
                </button>

                <button
                  type="button"
                  onClick={handleAddRow}
                  className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700"
                >
                  <Plus className="h-3 w-3" />
                  Add Row
                </button>
              </div>
            </div>

            {/* Export Success Alert */}
            {exportSuccess && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-800/60 bg-emerald-950/30 p-2.5 text-xs text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>{exportSuccess}</span>
              </div>
            )}

            {/* Editable Data Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/80 max-h-[550px] overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-800">
                  <tr>
                    <th className="p-2 text-center text-slate-500 w-8">#</th>
                    <th className="p-2 text-center text-slate-500 w-8">✕</th>
                    {currentHeaders.map((h) => (
                      <th
                        key={h}
                        className="p-2 font-medium text-slate-300 whitespace-nowrap"
                      >
                        {PRETTY_COLUMN_MAP[h] || h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredRows.map((row) => {
                    const originalIndex = rows.indexOf(row);
                    const isMissing = requiredKeys.some(
                      (k) => !String(row[k] || "").trim()
                    );
                    return (
                      <tr
                        key={originalIndex}
                        className={`transition hover:bg-slate-900/50 ${
                          isMissing ? "bg-amber-950/15" : ""
                        }`}
                      >
                        <td className="p-2 text-center font-mono text-slate-500">
                          {originalIndex + 1}
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(originalIndex)}
                            className="rounded p-0.5 text-slate-500 hover:text-red-400 transition"
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </td>
                        {currentHeaders.map((key) => {
                          const val = row[key] || "";
                          const isIdKey =
                            key.includes("id") || key === "uuid";
                          const isRequiredAndEmpty =
                            requiredKeys.includes(key) && !val.trim();

                          return (
                            <td
                              key={key}
                              className={`p-2 align-top min-w-[110px] max-w-[320px] ${
                                isRequiredAndEmpty
                                  ? "bg-amber-500/10 ring-1 ring-amber-500/20"
                                  : ""
                              }`}
                            >
                              <div
                                contentEditable
                                suppressContentEditableWarning
                                onBlur={(e) =>
                                  handleCellChange(
                                    originalIndex,
                                    key,
                                    e.currentTarget.textContent || ""
                                  )
                                }
                                className={`rounded px-1.5 py-0.5 transition focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                                  isIdKey
                                    ? "font-mono font-semibold text-blue-300"
                                    : "text-slate-200"
                                }`}
                              >
                                {val}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

