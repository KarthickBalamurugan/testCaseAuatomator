"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  FileSpreadsheet,
  FileJson,
  X,
  Loader2,
  Search,
  CheckCircle2,
  AlertCircle,
  ListChecks,
  Cable,
  Sparkles,
  Code2,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";
import Navbar from "../components/Navbar";
import { parseExcelWorkbook, type ParsedTestCase } from "@/lib/excelParser";
import { parsePortsWorkbook, type ParsedPort } from "@/lib/portExcelParser";
import {
  type RequirementGroup,
  type StandardizedTestCase,
} from "@/lib/standardizer-types";

/* ─── Styling Helpers ─────────────────────────────────────────── */

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 font-mono placeholder:text-slate-500 transition focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50";

const btnPrimary =
  "inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed";

const btnSecondary =
  "inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700 active:bg-slate-900";

/* ─── Normalized internal representation ──────────────────────── */

interface NormalizedTestCase {
  id: string;
  requirementId: string;
  title: string;
  objective: string;
  preconditions: string;
  ts: string;
  passFailCriteria: string;
  priority: string;
  status: string;
  notes: string;
}

/* ─── Component ───────────────────────────────────────────────── */

export default function TestGeneratorPage() {
  // Requirements state
  const [reqSource, setReqSource] = useState<
    "standardizer-xlsx" | "standardizer-json" | "parser-json"
  >("standardizer-xlsx");
  const [reqFileName, setReqFileName] = useState("");
  const [allTestCases, setAllTestCases] = useState<NormalizedTestCase[]>([]);
  const [reqParseError, setReqParseError] = useState("");

  // Ports state
  const [portsFileName, setPortsFileName] = useState("");
  const [parsedPorts, setParsedPorts] = useState<ParsedPort[]>([]);
  const [portsParseError, setPortsParseError] = useState("");
  const [portsParseWarning, setPortsParseWarning] = useState("");
  const [skippedInternal, setSkippedInternal] = useState(0);

  // Model & selection
  const [modelName, setModelName] = useState("ESC_Stability_Controller");
  const [reqId, setReqId] = useState("");
  const [matched, setMatched] = useState<NormalizedTestCase[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateSuccess, setGenerateSuccess] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  // Drag states
  const [isDraggingReqs, setIsDraggingReqs] = useState(false);
  const [isDraggingPorts, setIsDraggingPorts] = useState(false);

  const reqFileInputRef = useRef<HTMLInputElement>(null);
  const portsFileInputRef = useRef<HTMLInputElement>(null);

  /* ─── Derived values ─────────────────────────────────────── */

  const uniqueReqIds = useMemo(() => {
    const ids = new Set<string>();
    allTestCases.forEach((tc) => {
      const id = tc.requirementId.trim();
      if (id) ids.add(id);
    });
    return Array.from(ids);
  }, [allTestCases]);

  const inputPorts = useMemo(
    () => parsedPorts.filter((p) => p.ioRole === "Input"),
    [parsedPorts]
  );
  const outputPorts = useMemo(
    () => parsedPorts.filter((p) => p.ioRole === "Output"),
    [parsedPorts]
  );

  const totalCount = allTestCases.length;
  const matchCount = matched?.length ?? 0;

  /* ─── Normalization helpers ──────────────────────────────── */

  /** Normalize from excelParser's ParsedTestCase */
  function fromExcelParser(tc: ParsedTestCase): NormalizedTestCase {
    return {
      id: tc.testCaseId,
      requirementId: tc.requirementId,
      title: tc.title,
      objective: tc.objective,
      preconditions: tc.preconditions,
      ts: tc.ts,
      passFailCriteria: tc.passFailCriteria,
      priority: tc.priority,
      status: tc.status,
      notes: tc.notes,
    };
  }

  /** Normalize from standardizer-types StandardizedTestCase */
  function fromStandardizer(tc: StandardizedTestCase, reqId: string): NormalizedTestCase {
    return {
      id: tc.testCaseId,
      requirementId: tc.requirementId || reqId,
      title: tc.title,
      objective: tc.objective,
      preconditions: tc.preconditions,
      ts: tc.ts,
      passFailCriteria: tc.passFailCriteria,
      priority: tc.priority,
      status: tc.status,
      notes: tc.notes,
    };
  }

  /* ─── Requirements file handling ─────────────────────────── */

  const processReqFile = useCallback(async (file: File) => {
    setReqParseError("");
    setReqFileName("");
    setAllTestCases([]);
    setMatched(null);
    setReqId("");
    setShowAll(false);
    setGenerateError("");
    setGenerateSuccess("");

    const ext = file.name.split(".").pop()?.toLowerCase();

    try {
      if (ext === "xlsx" || ext === "xls") {
        const buffer = await file.arrayBuffer();
        const result = parseExcelWorkbook(buffer);
        if (result.testCases.length === 0) {
          setReqParseError("No test cases found. Ensure the file has a 'Test Case ID' column.");
          return;
        }
        const normalized = result.testCases.map(fromExcelParser);
        setAllTestCases(normalized);
        setReqFileName(file.name);
      } else if (ext === "json") {
        const text = await file.text();
        const json = JSON.parse(text);

        // Handle standardizer JSON output: { docRef, module, total, requirements: RequirementRow[] }
        if (json.requirements && Array.isArray(json.requirements)) {
          // Parser JSON format — these are RequirementRow[], not test cases.
          // They don't have testCaseId, so convert requirements into pseudo-test-cases
          const normalized: NormalizedTestCase[] = [];
          json.requirements.forEach((r: Record<string, string>, idx: number) => {
            const reqId = r.req_id || r.requirementId || `REQ-${idx + 1}`;
            normalized.push({
              id: r.test_case_id || r.tc_id || `TC-${String(idx + 1).padStart(3, "0")}`,
              requirementId: reqId,
              title: r.title || "",
              objective: r.objective || r.description || "",
              preconditions: r.preconditions || "",
              ts: r.ts || "",
              passFailCriteria: r.pass_fail_criteria || r.expected_result || "",
              priority: r.priority || "High",
              status: r.status || "Not Run",
              notes: "",
            });
          });
          setAllTestCases(normalized);
          setReqFileName(file.name);
          return;
        }

        // Handle array of { requirementId, testCases: StandardizedTestCase[] } groups
        if (Array.isArray(json)) {
          if (
            json.length > 0 &&
            json[0].requirementId &&
            Array.isArray(json[0].testCases)
          ) {
            // Standardizer group format
            const normalized: NormalizedTestCase[] = [];
            for (const group of json) {
              const reqId = group.requirementId;
              for (const tc of group.testCases) {
                normalized.push(fromStandardizer(tc, reqId));
              }
            }
            setAllTestCases(normalized);
            setReqFileName(file.name);
            return;
          }
          // Could be a flat array of test cases
          if (json.length > 0 && (json[0].testCaseId || json[0].id)) {
            const normalized: NormalizedTestCase[] = json.map(
              (tc: Record<string, string>, idx: number) => ({
                id: tc.testCaseId || tc.id || `TC-${String(idx + 1).padStart(3, "0")}`,
                requirementId: tc.requirementId || "REQ-GENERAL",
                title: tc.title || "",
                objective: tc.objective || "",
                preconditions: tc.preconditions || "",
                ts: tc.ts || "",
                passFailCriteria: tc.passFailCriteria || tc.criteria || "",
                priority: tc.priority || "High",
                status: tc.status || "Not Run",
                notes: tc.notes || "",
              })
            );
            setAllTestCases(normalized);
            setReqFileName(file.name);
            return;
          }
        }

        setReqParseError(
          "Unrecognized JSON format. Expected standardizer output ({ requirements: [...] } or [{ requirementId, testCases }])."
        );
      } else {
        setReqParseError("Unsupported file type. Use .xlsx or .json files.");
      }
    } catch {
      setReqParseError("Failed to parse file. Ensure it is a valid Excel or JSON file.");
    }
  }, []);

  const handleReqFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processReqFile(file);
  };

  const handleReqDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingReqs(false);
      const file = e.dataTransfer.files[0];
      if (file) processReqFile(file);
    },
    [processReqFile]
  );

  const clearReqs = () => {
    setReqFileName("");
    setAllTestCases([]);
    setMatched(null);
    setReqId("");
    setShowAll(false);
    setGenerateError("");
    setGenerateSuccess("");
    setGeneratedCode("");
  };

  /* ─── Ports file handling ────────────────────────────────── */

  const processPortsFile = useCallback(async (file: File) => {
    setPortsParseError("");
    setPortsParseWarning("");
    setParsedPorts([]);
    setSkippedInternal(0);
    setGenerateError("");
    setGenerateSuccess("");

    try {
      const buffer = await file.arrayBuffer();
      const result = parsePortsWorkbook(buffer);
      if (result.ports.length === 0) {
        setPortsParseError(
          result.warnings[0] || "No Input/Output ports found. Internal rows are skipped."
        );
        setPortsFileName("");
        return;
      }
      setParsedPorts(result.ports);
      setSkippedInternal(result.skippedInternal);
      setPortsFileName(file.name);
      if (result.warnings.length > 0) {
        setPortsParseWarning(result.warnings.join(" "));
      }
    } catch {
      setPortsParseError("Could not read this file. Is it a valid .xlsx?");
    }
  }, []);

  const handlePortsFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processPortsFile(file);
    e.target.value = "";
  };

  const handlePortsDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingPorts(false);
      const file = e.dataTransfer.files[0];
      if (file) processPortsFile(file);
    },
    [processPortsFile]
  );

  const clearPorts = () => {
    setPortsFileName("");
    setParsedPorts([]);
    setPortsParseError("");
    setPortsParseWarning("");
    setSkippedInternal(0);
  };

  /* ─── Requirement selection ──────────────────────────────── */

  const handleReqIdChange = (value: string) => {
    setReqId(value);
    setShowAll(false);
    setGenerateError("");
    setGenerateSuccess("");
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      setMatched(null);
      return;
    }
    setMatched(
      allTestCases.filter(
        (tc) => tc.requirementId.trim().toLowerCase() === trimmed
      )
    );
  };

  const handleSelectAll = () => {
    setReqId("");
    setShowAll(true);
    setMatched(allTestCases);
    setGenerateError("");
    setGenerateSuccess("");
  };

  /* ─── Generate ───────────────────────────────────────────── */

  const handleGenerate = async () => {
    setGenerateError("");
    setGenerateSuccess("");
    setGeneratedCode("");

    if (!modelName.trim()) {
      setGenerateError("Enter a model name.");
      return;
    }
    if (inputPorts.length === 0) {
      setGenerateError("Upload a ports workbook with at least one Input port.");
      return;
    }
    if (!showAll && (!reqId.trim() || !matched || matched.length === 0)) {
      setGenerateError("Select a requirement ID with matching test cases.");
      return;
    }

    const portNames = inputPorts.map((p) => p.name);
    const portSpecs = parsedPorts.map((p) => ({
      name: p.name,
      ioRole: p.ioRole,
      datatype: p.datatype,
    }));

    const activeCases = showAll ? allTestCases : matched!;

    // Build structured test cases for the API
    const structuredTestCases = activeCases.map((tc) => ({
      id: tc.id,
      title: tc.title,
      objective: tc.objective,
      criteria: tc.passFailCriteria,
      ...(showAll ? { requirementId: tc.requirementId } : {}),
    }));

    const payload: Record<string, unknown> = {
      modelName: modelName.trim(),
      testCases: structuredTestCases,
      ports: portNames,
      portSpecs,
      count: activeCases.length,
    };

    if (showAll) {
      payload.requirementIds = uniqueReqIds;
    } else {
      payload.requirementId = reqId.trim();
    }

    setIsGenerating(true);
    try {
      const res = await fetch("/api/generate-testsuite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Request failed with status ${res.status}`);
      }

      // Response is the .m file as plain text
      const matlabCode = await res.text();
      setGeneratedCode(matlabCode);

      // Also download the file
      const blob = new Blob([matlabCode], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeFileId = showAll
        ? "ALL"
        : reqId.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
      a.download = `MBD_TestSuite_${safeFileId}.m`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const reqLabel = showAll
        ? `${uniqueReqIds.length} requirements · ${allTestCases.length} test cases`
        : `${reqId.trim()} · ${matched!.length} test cases`;
      setGenerateSuccess(`Downloaded: MBD_TestSuite_${safeFileId}.m (${reqLabel})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Generation failed.";
      setGenerateError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyCode = () => {
    if (!generatedCode) return;
    navigator.clipboard.writeText(generatedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /* ─── Render ─────────────────────────────────────────────── */

  const hasReqs = allTestCases.length > 0;
  const hasPorts = parsedPorts.length > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Navbar />

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Page Header */}
        <div className="mb-8 flex items-center gap-3">
          <Code2 className="h-8 w-8 text-blue-400" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">
              Test Generator
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Feed standardized test requirements and I/O ports to the LLM to
              generate a MATLAB Simulink test suite.
            </p>
          </div>
        </div>

        {/* ─── INPUTS ─────────────────────────────────────────── */}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* LEFT COLUMN: Inputs */}
          <div className="space-y-4">
            {/* Model Name */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5 block">
                Simulink Model Name
              </label>
              <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="e.g. ESC_Stability_Controller"
                className={inputCls}
              />
            </div>

            {/* Requirements Upload */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Test Requirements
                </label>
                {hasReqs && (
                  <span className="text-xs text-emerald-400 font-mono">
                    {totalCount} test cases · {uniqueReqIds.length} reqs
                  </span>
                )}
              </div>

              {!reqFileName ? (
                <label
                  onDrop={handleReqDrop}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingReqs(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDraggingReqs(false);
                  }}
                  className={`flex items-center gap-2.5 rounded-lg border-2 border-dashed px-3 py-3 cursor-pointer transition-all text-sm ${
                    isDraggingReqs
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-slate-700 bg-slate-800 hover:border-slate-600"
                  }`}
                >
                  <Upload className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="text-slate-300">
                    Drop .xlsx (Standardized) or .json (Standardizer/Parser)
                  </span>
                  <input
                    ref={reqFileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.json"
                    onChange={handleReqFileChange}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2">
                  <FileSpreadsheet className="h-4 w-4 text-blue-400 shrink-0" />
                  <span className="text-sm text-blue-300 truncate flex-1">
                    {reqFileName}
                  </span>
                  <span className="text-xs text-emerald-400 font-mono shrink-0">
                    {totalCount} tc
                  </span>
                  <button
                    onClick={clearReqs}
                    className="text-slate-400 hover:text-white transition shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {reqParseError && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {reqParseError}
                </div>
              )}

              {hasReqs && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Accepted: Standardized Excel (from Standardizer page) or JSON
                  output from the Parser or Standardizer.
                </p>
              )}
            </div>

            {/* Requirement Selection */}
            {hasReqs && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5 block">
                  Requirement ID
                </label>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={reqId}
                    onChange={(e) => handleReqIdChange(e.target.value)}
                    placeholder="REQ-IB_BHMS-SC-PSB-002"
                    className={inputCls + " pl-9 pr-8"}
                  />
                  {reqId && (
                    <button
                      onClick={() => handleReqIdChange("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                  <button
                    onClick={handleSelectAll}
                    className={`rounded-md px-2 py-0.5 text-xs font-medium transition-all inline-flex items-center gap-1 ${
                      showAll
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                    }`}
                  >
                    <ListChecks className="h-3 w-3" />
                    All ({totalCount})
                  </button>
                  {uniqueReqIds.map((id) => (
                    <button
                      key={id}
                      onClick={() => handleReqIdChange(id)}
                      className={`rounded-md px-2 py-0.5 text-xs font-mono transition-all ${
                        reqId.trim().toLowerCase() === id.toLowerCase()
                          ? "bg-blue-600 text-white"
                          : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                      }`}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Ports Workbook */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  I/O Ports Workbook
                </label>
                {parsedPorts.length > 0 && (
                  <span className="text-xs text-slate-500 font-mono">
                    {inputPorts.length} in · {outputPorts.length} out
                    {skippedInternal > 0 ? ` · ${skippedInternal} internal` : ""}
                  </span>
                )}
              </div>

              {!portsFileName ? (
                <label
                  onDrop={handlePortsDrop}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingPorts(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDraggingPorts(false);
                  }}
                  className={`flex items-center gap-2.5 rounded-lg border-2 border-dashed px-3 py-3 cursor-pointer transition-all text-sm ${
                    isDraggingPorts
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-slate-700 bg-slate-800 hover:border-slate-600"
                  }`}
                >
                  <Cable className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="text-slate-300">
                    Drop IO .xlsx (Input/Output ports only)
                  </span>
                  <input
                    ref={portsFileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handlePortsFileChange}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2">
                  <FileSpreadsheet className="h-4 w-4 text-blue-400 shrink-0" />
                  <span className="text-sm text-blue-300 truncate flex-1">
                    {portsFileName}
                  </span>
                  <button
                    onClick={clearPorts}
                    className="text-slate-400 hover:text-white transition shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {portsParseError && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {portsParseError}
                </div>
              )}
              {portsParseWarning && !portsParseError && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {portsParseWarning}
                </div>
              )}

              {parsedPorts.length > 0 && (
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-[11px] font-medium text-slate-400 mb-1.5">
                      Input Ports
                    </p>
                    {inputPorts.length === 0 ? (
                      <p className="text-xs text-amber-400">
                        No Input ports found. Internal rows were skipped.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {inputPorts.map((p) => (
                          <span
                            key={`in-${p.signalId || p.name}`}
                            className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-slate-200"
                            title={p.datatype || undefined}
                          >
                            {p.name}
                            {p.datatype ? (
                              <span className="text-slate-500">
                                {" "}
                                · {p.datatype}
                              </span>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-slate-400 mb-1.5">
                      Output Ports
                    </p>
                    {outputPorts.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No Output ports found.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {outputPorts.map((p) => (
                          <span
                            key={`out-${p.signalId || p.name}`}
                            className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-slate-200"
                            title={p.datatype || undefined}
                          >
                            {p.name}
                            {p.datatype ? (
                              <span className="text-slate-500">
                                {" "}
                                · {p.datatype}
                              </span>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Generate Button */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    Generate MATLAB Test Suite
                  </p>
                  <p className="text-xs text-slate-500">
                    {showAll
                      ? `All ${uniqueReqIds.length} requirements · ${totalCount} test cases`
                      : matched
                      ? `${matched.length} test case${matched.length !== 1 ? "s" : ""} selected`
                      : "Select a requirement to proceed"}
                  </p>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !hasReqs || !hasPorts}
                  className={btnPrimary}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      {showAll ? "Generate All" : "Generate"}
                    </>
                  )}
                </button>
              </div>

              {generateError && (
                <div className="mt-3 flex items-center gap-1.5 text-xs text-red-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {generateError}
                </div>
              )}
              {generateSuccess && (
                <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  {generateSuccess}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Preview + Generated Code */}
          <div className="space-y-4">
            {/* Test Case Preview */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  {showAll ? "All Test Cases" : "Test Case Preview"}
                </h2>
                {matched !== null && (
                  <span className="text-xs font-mono text-blue-400">
                    {showAll
                      ? `${matchCount} cases · ${uniqueReqIds.length} reqs`
                      : `${matchCount} result${matchCount === 1 ? "" : "s"}`}
                  </span>
                )}
              </div>

              {matched === null ? (
                <div className="flex min-h-[250px] flex-col items-center justify-center text-center px-6">
                  <div>
                    <p className="text-sm text-slate-500">
                      {hasReqs
                        ? "Search a requirement to preview test cases"
                        : "Upload test requirements to get started"}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      {hasReqs
                        ? `${totalCount} cases loaded`
                        : "Supports Standardized Excel or JSON from Parser/Standardizer"}
                    </p>
                  </div>
                </div>
              ) : matched.length === 0 ? (
                <div className="flex min-h-[250px] flex-col items-center justify-center text-center px-6">
                  <p className="text-sm text-amber-400">No matches</p>
                  <p className="text-xs text-slate-500 mt-1">
                    &quot;{reqId}&quot; not found in the loaded data
                  </p>
                </div>
              ) : (
                <div className="space-y-2 overflow-y-auto max-h-[400px] pr-1">
                  {matched.map((tc, i) => (
                    <div
                      key={`${tc.id}-${i}`}
                      className="rounded-lg border border-slate-800 bg-slate-800/40 p-3 hover:border-slate-700 transition"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div>
                          {showAll && (
                            <span className="text-[10px] font-mono text-slate-500 block mb-0.5">
                              {tc.requirementId}
                            </span>
                          )}
                          <span className="font-mono text-xs font-semibold text-blue-400">
                            {tc.id}
                          </span>
                          <p className="text-xs text-slate-200 mt-0.5">
                            {tc.title || "Untitled"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {tc.priority && (
                            <span
                              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                tc.priority.toLowerCase() === "high"
                                  ? "bg-red-500/15 text-red-400"
                                  : tc.priority.toLowerCase() === "medium"
                                  ? "bg-amber-500/15 text-amber-400"
                                  : "bg-slate-700/50 text-slate-400"
                              }`}
                            >
                              {tc.priority}
                            </span>
                          )}
                        </div>
                      </div>
                      {tc.objective && (
                        <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                          {tc.objective}
                        </p>
                      )}
                      {tc.passFailCriteria && (
                        <p className="text-[11px] text-slate-500 mt-1 italic">
                          Pass/Fail: {tc.passFailCriteria}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Generated Code Preview */}
            {generatedCode && (
              <div className="rounded-xl border border-blue-800/30 bg-blue-950/10 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-[11px] font-medium uppercase tracking-wider text-blue-300 inline-flex items-center gap-1.5">
                    <FileJson className="h-3.5 w-3.5" />
                    Generated MATLAB Code
                  </h2>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCopyCode}
                      className={btnSecondary}
                    >
                      {copied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-green-400" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copy
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setShowCode(!showCode)}
                      className={btnSecondary}
                    >
                      {showCode ? (
                        <>
                          <ChevronDown className="h-3.5 w-3.5" />
                          Collapse
                        </>
                      ) : (
                        <>
                          <ChevronRight className="h-3.5 w-3.5" />
                          Expand
                        </>
                      )}
                    </button>
                  </div>
                </div>
                {(showCode || !generatedCode.includes("\n")) && (
                  <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-300">
                    {generatedCode}
                  </pre>
                )}
                {!showCode && generatedCode.includes("\n") && (
                  <p className="text-xs text-slate-500">
                    {generatedCode.split("\n").length} lines · Click Expand to
                    preview
                  </p>
                )}
              </div>
            )}

            {/* Placeholder when no results */}
            {!generatedCode && !isGenerating && (
              <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900/30 text-center">
                <Code2 className="mb-3 h-10 w-10 text-slate-700" />
                <p className="text-sm text-slate-500">
                  Generated MATLAB test suite will appear here.
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  Upload requirements + ports, select a requirement, and
                  generate.
                </p>
              </div>
            )}

            {isGenerating && (
              <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border border-blue-800/30 bg-blue-950/10">
                <Loader2 className="mb-3 h-10 w-10 animate-spin text-blue-400" />
                <p className="text-sm text-blue-300">
                  Sending to LLM — generating MATLAB test blocks...
                </p>
                <p className="text-xs text-blue-400/60 mt-1">
                  This may take a few minutes for large test suites.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
