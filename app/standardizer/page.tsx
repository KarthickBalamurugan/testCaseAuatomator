"use client";

import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  FileSpreadsheet,
  Sparkles,
  X,
  Loader2,
  Download,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Table2,
  FileText,
  Braces,
  FileCode,
} from "lucide-react";
import Navbar from "../components/Navbar";
import {
  DEFAULT_STANDARDIZER_PROMPT,
  type RequirementGroup,
  type StandardizedTestCase,
} from "@/lib/standardizer-types";

/* ─── Styling Helpers ─────────────────────────────────────────── */

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 transition focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50";

const btnPrimary =
  "inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed";

const btnSecondary =
  "inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700 active:bg-slate-900";

/* ─── Helpers ────────────────────────────────────────────────── */

/** Convert plain text to a simple base64-encoded XLSX with the text in a single "Raw Input" cell. */
function textToBase64Xlsx(text: string): string {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([["Raw Input"], [text]]);
  XLSX.utils.book_append_sheet(wb, ws, "Input");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

/** Parse a returned Excel blob into groups for preview. */
function parseReturnedExcel(blob: Blob): Promise<RequirementGroup[]> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

        const groupMap = new Map<string, StandardizedTestCase[]>();

        for (const row of rows) {
          const reqId =
            row["Requirement ID"] || row["requirementId"] || "REQ-UNKNOWN";
          const tc: StandardizedTestCase = {
            testCaseId: row["Test Case ID"] || row["testCaseId"] || "",
            requirementId: reqId,
            title: row["Title"] || row["title"] || "",
            objective: row["Objective"] || row["objective"] || "",
            preconditions: row["Preconditions"] || row["preconditions"] || "",
            ts: row["ts (s)"] || row["ts"] || "",
            passFailCriteria:
              row["Pass/Fail Criteria"] || row["passFailCriteria"] || "",
            priority: row["Priority"] || row["priority"] || "High",
            status: row["Status"] || row["status"] || "Not Run",
            notes: row["Notes"] || row["notes"] || "",
          };
          if (!groupMap.has(reqId)) groupMap.set(reqId, []);
          groupMap.get(reqId)!.push(tc);
        }

        const groups: RequirementGroup[] = Array.from(groupMap.entries()).map(
          ([requirementId, testCases]) => ({ requirementId, testCases })
        );
        resolve(groups);
      } catch {
        resolve([]);
      }
    };
    reader.onerror = () => resolve([]);
    reader.readAsArrayBuffer(blob);
  });
}

/* ─── Component ───────────────────────────────────────────────── */

export default function StandardizerPage() {
  // Input state
  const [fileBase64, setFileBase64] = useState("");
  const [fileName, setFileName] = useState("");
  const [rawInput, setRawInput] = useState(""); // for text/CSV fallback
  const [prompt, setPrompt] = useState(DEFAULT_STANDARDIZER_PROMPT);
  const [model, setModel] = useState("gemini-3.5-flash-lite");

  // Output state
  const [groups, setGroups] = useState<RequirementGroup[]>([]);
  const [rawOutput, setRawOutput] = useState("");
  const [stats, setStats] = useState<{
    requirementsCount: number;
    testCasesCount: number;
    inputCharCount: number;
    model: string;
  } | null>(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [expandedReqs, setExpandedReqs] = useState<Set<string>>(new Set());
  const [showPrompt, setShowPrompt] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  /* ─── File Handling ──────────────────────────────────────────── */

  const processFile = useCallback((file: File) => {
    setError("");
    setFileName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase();

    if (ext === "xlsx" || ext === "xls") {
      // Read Excel as base64 — send directly to LLM
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const dataUrl = e.target?.result as string;
          const base64 = dataUrl.split(",")[1];
          if (!base64) {
            setError("Failed to read Excel file as base64.");
            setFileName("");
            return;
          }
          setFileBase64(base64);
          setRawInput(""); // clear any text input
        } catch {
          setError("Failed to read Excel file.");
          setFileName("");
        }
      };
      reader.readAsDataURL(file);
    } else if (ext === "csv" || ext === "txt" || ext === "tsv") {
      // Text files: convert to simple XLSX so we can still send a file
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setRawInput(text);
        setFileBase64(textToBase64Xlsx(text));
      };
      reader.readAsText(file);
    } else if (ext === "pdf") {
      // Use the existing parse-document API to get text, then convert
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const rawBase64 = (e.target?.result as string).split(",")[1];
          const res = await fetch("/api/parse-document", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileBase64: rawBase64, fileName: file.name }),
          });
          const json = await res.json();
          if (json.text) {
            setRawInput(json.text);
            setFileBase64(textToBase64Xlsx(json.text));
          } else {
            setError(json.error || "Failed to parse PDF.");
          }
        } catch {
          setError("Failed to parse PDF document.");
        }
      };
      reader.readAsDataURL(file);
    } else {
      // Unknown: try as text
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setRawInput(text);
        setFileBase64(textToBase64Xlsx(text));
      };
      reader.readAsText(file);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dropRef.current?.classList.remove("border-blue-500");
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropRef.current?.classList.add("border-blue-500");
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropRef.current?.classList.remove("border-blue-500");
  };

  /* ─── Standardize ────────────────────────────────────────────── */

  const handleStandardize = async () => {
    if (!fileBase64) {
      setError("Please upload a file first.");
      return;
    }
    setLoading(true);
    setError("");
    setGroups([]);
    setRawOutput("");
    setStats(null);

    try {
      const res = await fetch("/api/standardize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileBase64,
          fileName,
          customPrompt: prompt,
          model,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const errMsg = json.error || `Standardization failed (${res.status}).`;
        const debugMsg = json.debug
          ? `\n\nDebug: models tried — ${json.debug.modelsAttempted?.join(", ") || "unknown"}\nResponse preview:\n${json.debug.responsePreview || "(empty)"}`
          : "";
        setError(errMsg + debugMsg);
        return;
      }

      // The response is a binary .xlsx file
      const blob = await res.blob();
      if (blob.size === 0) {
        setError("The server returned an empty file.");
        return;
      }

      // Trigger download of the standardized Excel
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?(.+?)"?$/);
      a.download = filenameMatch
        ? filenameMatch[1]
        : `${fileName.replace(/\.[^.]+$/, "") || "standardized"}_standardized.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Parse the returned Excel for preview
      const previewGroups = await parseReturnedExcel(blob);
      if (previewGroups.length > 0) {
        setGroups(previewGroups);
        setExpandedReqs(new Set(previewGroups.map((g) => g.requirementId)));
        setStats({
          requirementsCount: previewGroups.length,
          testCasesCount: previewGroups.reduce(
            (sum, g) => sum + g.testCases.length,
            0
          ),
          inputCharCount: fileBase64.length,
          model,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  };

  /* ─── Copy Raw Output ────────────────────────────────────────── */

  const handleCopy = () => {
    navigator.clipboard.writeText(rawOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /* ─── Toggle Requirement Group ───────────────────────────────── */

  const toggleReq = (reqId: string) => {
    setExpandedReqs((prev) => {
      const next = new Set(prev);
      if (next.has(reqId)) next.delete(reqId);
      else next.add(reqId);
      return next;
    });
  };

  /* ─── Export Helpers ──────────────────────────────────────────── */

  const TC_COLS = [
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

  /** Columns for the on-screen table display (Requirement ID is shown in the group header) */
  const DISPLAY_COLS = TC_COLS.filter((c) => c !== "Requirement ID");

  const tcToRow = (reqId: string, tc: StandardizedTestCase) => [
    reqId,
    tc.testCaseId,
    tc.title,
    tc.objective,
    tc.preconditions,
    tc.ts,
    tc.passFailCriteria,
    tc.priority,
    tc.status,
    tc.notes,
  ];

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    // Single flat sheet — Requirement ID is a column, automator-compatible
    const rows: (string | number)[][] = [TC_COLS];
    groups.forEach((g) => {
      g.testCases.forEach((tc) => rows.push(tcToRow(g.requirementId, tc)));
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const colWidths = TC_COLS.map((_, i) => {
      const maxLen = rows.reduce(
        (max, row) => Math.max(max, String(row[i] || "").length),
        TC_COLS[i].length
      );
      return { wch: Math.min(maxLen + 2, 60) };
    });
    ws["!cols"] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, "Standardized");
    XLSX.writeFile(wb, "standardized_testcases.xlsx");
  };

  const exportCSV = () => {
    const rows: string[][] = [TC_COLS];
    groups.forEach((g) => {
      g.testCases.forEach((tc) => rows.push(tcToRow(g.requirementId, tc) as string[]));
    });
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "standardized_testcases.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJSON = () => {
    const data = groups.map((g) => ({
      requirementId: g.requirementId,
      testCases: g.testCases,
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "standardized_testcases.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ─── Render ─────────────────────────────────────────────────── */

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Page Header */}
        <div className="mb-8 flex items-center gap-3">
          <Sparkles className="h-8 w-8 text-blue-400" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">
              Testcase Standardizer
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Upload an Excel file — the LLM will standardize it and return a
              downloadable Excel compatible with the Testcase Automator.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* ─── LEFT COLUMN: Input ─────────────────────────────── */}

          <div className="space-y-4">
            {/* File Upload */}
            <div
              ref={dropRef}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-700 bg-slate-900 p-6 transition hover:border-blue-500 hover:bg-slate-800/60"
            >
              <Upload className="h-8 w-8 text-slate-500" />
              <span className="text-sm text-slate-400">
                Drop an Excel, CSV, or text file here, or{" "}
                <span className="text-blue-400 underline">browse</span>
              </span>
              {fileName && (
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {fileName}
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.tsv,.txt,.pdf"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {/* Raw Text Input (for manual entry / paste) */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-300">
                Input Text
                <span className="ml-2 text-xs text-slate-500">
                  (optional — paste text directly if no Excel file)
                </span>
              </label>
              <textarea
                value={rawInput}
                onChange={(e) => {
                  setRawInput(e.target.value);
                  // Convert typed text to a simple XLSX for sending
                  if (e.target.value.trim()) {
                    setFileBase64(textToBase64Xlsx(e.target.value));
                  } else {
                    setFileBase64("");
                  }
                }}
                rows={12}
                placeholder="Paste your raw requirements, test cases, or engineering descriptions here..."
                className={`${inputCls} resize-y font-mono text-xs leading-relaxed`}
              />
              {rawInput && (
                <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                  <span>{rawInput.length.toLocaleString()} characters</span>
                  <button
                    onClick={() => {
                      setRawInput("");
                      setFileBase64("");
                      setFileName("");
                    }}
                    className="text-red-400 hover:text-red-300"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {/* Prompt Editor (collapsible) */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50">
              <button
                onClick={() => setShowPrompt(!showPrompt)}
                className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-slate-300 transition hover:text-white"
              >
                {showPrompt ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Standardization Prompt
                <span className="ml-auto text-xs text-slate-500">
                  {prompt.length.toLocaleString()} chars
                </span>
              </button>
              {showPrompt && (
                <div className="border-t border-slate-800 px-4 pb-4">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={10}
                    className={`${inputCls} mt-3 resize-y font-mono text-xs leading-relaxed`}
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    The <code className="text-blue-400">{"{{USER_INPUT}}"}</code>{" "}
                    placeholder will be replaced with the uploaded file.
                  </p>
                </div>
              )}
            </div>

            {/* Model Selector + Standardize Button */}
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="mb-1.5 block text-sm font-medium text-slate-300">
                  Model
                </label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className={inputCls}
                >
                  <option value="gemini-3.5-flash-lite">
                    gemini-3.5-flash-lite
                  </option>
                  <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                </select>
              </div>
              <button
                onClick={handleStandardize}
                disabled={loading || !fileBase64}
                className={btnPrimary}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Standardizing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Standardize
                  </>
                )}
              </button>
            </div>

            {error && (
              <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}
          </div>

          {/* ─── RIGHT COLUMN: Output ───────────────────────────── */}

          <div className="space-y-4">
            {!groups.length && !loading && !error && (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900/30 text-center">
                <Sparkles className="mb-3 h-10 w-10 text-slate-700" />
                <p className="text-sm text-slate-500">
                  Output will appear here after standardization.
                </p>
              </div>
            )}

            {loading && (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-xl border border-blue-800/30 bg-blue-950/10">
                <Loader2 className="mb-3 h-10 w-10 animate-spin text-blue-400" />
                <p className="text-sm text-blue-300">
                  Sending to LLM — this may take a moment...
                </p>
              </div>
            )}

            {/* Stats Bar */}
            {stats && (
              <div className="flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
                <div className="text-center">
                  <div className="text-lg font-bold text-white">
                    {stats.requirementsCount}
                  </div>
                  <div className="text-xs text-slate-400">Requirements</div>
                </div>
                <div className="w-px bg-slate-700" />
                <div className="text-center">
                  <div className="text-lg font-bold text-white">
                    {stats.testCasesCount}
                  </div>
                  <div className="text-xs text-slate-400">Test Cases</div>
                </div>
                <div className="w-px bg-slate-700" />
                <div className="text-center">
                  <div className="text-lg font-bold text-white">
                    {stats.inputCharCount.toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-400">Input Size</div>
                </div>
                <div className="w-px bg-slate-700" />
                <div className="text-center">
                  <div className="text-sm font-medium text-blue-400">
                    {stats.model}
                  </div>
                  <div className="text-xs text-slate-400">Model</div>
                </div>
              </div>
            )}

            {/* Export Buttons */}
            {groups.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button onClick={exportExcel} className={btnSecondary}>
                  <FileSpreadsheet className="h-4 w-4" />
                  Re-export Excel
                </button>
                <button onClick={exportCSV} className={btnSecondary}>
                  <FileText className="h-4 w-4" />
                  Export CSV
                </button>
                <button onClick={exportJSON} className={btnSecondary}>
                  <Braces className="h-4 w-4" />
                  Export JSON
                </button>
                <button onClick={handleCopy} className={btnSecondary}>
                  {copied ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copied ? "Copied!" : "Copy Raw"}
                </button>
                <button
                  onClick={() => setShowRaw(!showRaw)}
                  className={btnSecondary}
                >
                  <FileCode className="h-4 w-4" />
                  {showRaw ? "Table View" : "Raw View"}
                </button>
              </div>
            )}

            {/* Raw Output View */}
            {showRaw && rawOutput && (
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-300">
                  {rawOutput}
                </pre>
              </div>
            )}

            {/* Parsed Table View */}
            {!showRaw && groups.length > 0 && (
              <div className="space-y-3">
                {groups.map((group) => (
                  <div
                    key={group.requirementId}
                    className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden"
                  >
                    {/* Requirement Header */}
                    <button
                      onClick={() => toggleReq(group.requirementId)}
                      className="flex w-full items-center gap-2 bg-slate-800/60 px-4 py-3 text-left transition hover:bg-slate-800"
                    >
                      {expandedReqs.has(group.requirementId) ? (
                        <ChevronDown className="h-4 w-4 text-slate-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      )}
                      <Table2 className="h-4 w-4 text-blue-400" />
                      <span className="text-sm font-semibold text-white">
                        {group.requirementId}
                      </span>
                      <span className="ml-auto text-xs text-slate-500">
                        {group.testCases.length} test case
                        {group.testCases.length !== 1 ? "s" : ""}
                      </span>
                    </button>

                    {/* Test Cases Table */}
                    {expandedReqs.has(group.requirementId) && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-700 bg-slate-800/40 text-left text-slate-400">
                              {DISPLAY_COLS.map((col) => (
                                <th
                                  key={col}
                                  className="whitespace-nowrap px-3 py-2 font-medium"
                                >
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {group.testCases.map((tc, i) => (
                              <tr
                                key={`${tc.testCaseId}-${i}`}
                                className="border-b border-slate-800/50 transition hover:bg-slate-800/30"
                              >
                                <td className="whitespace-nowrap px-3 py-2 font-mono text-blue-400">
                                  {tc.testCaseId}
                                </td>
                                <td className="px-3 py-2 text-slate-200">
                                  {tc.title}
                                </td>
                                <td className="max-w-[250px] px-3 py-2 text-slate-300">
                                  {tc.objective}
                                </td>
                                <td className="max-w-[200px] px-3 py-2 text-slate-400">
                                  {tc.preconditions}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-300">
                                  {tc.ts}
                                </td>
                                <td className="max-w-[250px] px-3 py-2 text-slate-300">
                                  {tc.passFailCriteria}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2">
                                  <span
                                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                                      tc.priority === "High"
                                        ? "bg-red-900/40 text-red-300"
                                        : tc.priority === "Medium"
                                          ? "bg-yellow-900/40 text-yellow-300"
                                          : "bg-slate-700/50 text-slate-400"
                                    }`}
                                  >
                                    {tc.priority}
                                  </span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2">
                                  <span
                                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                                      tc.status === "Pass"
                                        ? "bg-green-900/40 text-green-300"
                                        : tc.status === "Fail"
                                          ? "bg-red-900/40 text-red-300"
                                          : tc.status === "Blocked"
                                            ? "bg-orange-900/40 text-orange-300"
                                            : "bg-slate-700/50 text-slate-400"
                                    }`}
                                  >
                                    {tc.status}
                                  </span>
                                </td>
                                <td className="max-w-[200px] px-3 py-2 text-slate-500">
                                  {tc.notes}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
