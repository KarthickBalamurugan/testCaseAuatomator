"use client";

import { useState, useMemo, ChangeEvent, DragEvent } from "react";
import {
  Upload,
  FileSpreadsheet,
  Search,
  X,
  CheckCircle2,
  AlertCircle,
  Download,
  Check,
  Plus,
  Minus,
} from "lucide-react";
import Navbar from "./components/Navbar";
import { parseExcelWorkbook, type ParsedTestCase } from "@/lib/excelParser";

export interface BusPort {
  name: string;
}

export interface BusConfig {
  portCount: string | number;
  ports: BusPort[];
}

function parseWorkbook(arrayBuffer: ArrayBuffer): ParsedTestCase[] {
  const result = parseExcelWorkbook(arrayBuffer);
  return result.testCases;
}

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 font-mono placeholder:text-slate-500 transition focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50";

export default function TestRequirementForm() {
  const [modelName, setModelName] = useState("ESC_Stability_Controller");
  const [fileName, setFileName] = useState("");
  const [allTestCases, setAllTestCases] = useState<ParsedTestCase[]>([]);
  const [parseError, setParseError] = useState("");
  const [numBuses, setNumBuses] = useState("");
  const [buses, setBuses] = useState<BusConfig[]>([]);
  const [reqId, setReqId] = useState("");
  const [matched, setMatched] = useState<ParsedTestCase[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateSuccess, setGenerateSuccess] = useState("");
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const uniqueReqIds = useMemo(() => {
    const ids = new Set<string>();
    allTestCases.forEach((tc) => {
      const id = tc.requirementId.trim();
      if (id) ids.add(id);
    });
    return Array.from(ids);
  }, [allTestCases]);

  const handleFileUpload = async (file?: File) => {
    if (!file) return;
    setParseError("");
    setMatched(null);
    setReqId("");
    setGenerateError("");
    setGenerateSuccess("");
    setNumBuses("");
    setBuses([]);

    try {
      const buffer = await file.arrayBuffer();
      const testCases = parseWorkbook(buffer);
      if (testCases.length === 0) {
        setParseError("No testcases found. Make sure the file has a 'Test case ID' column.");
        setAllTestCases([]);
        setFileName("");
        return;
      }
      setAllTestCases(testCases);
      setFileName(file.name);
    } catch {
      setParseError("Could not read this file. Is it a valid .xlsx?");
      setAllTestCases([]);
      setFileName("");
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    handleFileUpload(e.target.files?.[0]);
  };

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    handleFileUpload(e.dataTransfer.files?.[0]);
  };

  const clearFile = () => {
    setFileName("");
    setAllTestCases([]);
    setMatched(null);
    setReqId("");
    setParseError("");
    setGenerateError("");
    setGenerateSuccess("");
    setNumBuses("");
    setBuses([]);
  };

  const handleReqIdChange = (value: string) => {
    setReqId(value);
    setGenerateError("");
    setGenerateSuccess("");
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) {
      setMatched(null);
      return;
    }
    const results = allTestCases.filter(
      (tc) => tc.requirementId.trim().toLowerCase() === trimmed
    );
    setMatched(results);
  };

  const handleBusCountChange = (value: string) => {
    setNumBuses(value);
    const n = value === "" ? 0 : Math.max(0, parseInt(value, 10) || 0);
    setBuses((prev) => {
      const updated = [...prev];
      if (n > updated.length) {
        while (updated.length < n) updated.push({ portCount: "", ports: [] });
      } else {
        updated.splice(n);
      }
      return updated;
    });
  };

  const handleBusPortCountChange = (busIndex: number, value: string) => {
    const n = value === "" ? 0 : Math.max(0, parseInt(value, 10) || 0);
    setBuses((prev) => {
      const updated = [...prev];
      const currentBus = updated[busIndex] || { portCount: "", ports: [] };
      const nextPorts = [...currentBus.ports];
      if (n > nextPorts.length) {
        while (nextPorts.length < n) nextPorts.push({ name: "" });
      } else {
        nextPorts.splice(n);
      }
      updated[busIndex] = { ...currentBus, portCount: value, ports: nextPorts };
      return updated;
    });
  };

  const handleBusPortChange = (busIndex: number, portIndex: number, value: string) => {
    setBuses((prev) => {
      const updated = [...prev];
      const currentBus = updated[busIndex] || { portCount: 0, ports: [] };
      const updatedPorts = [...currentBus.ports];
      updatedPorts[portIndex] = { name: value };
      updated[busIndex] = { ...currentBus, ports: updatedPorts };
      return updated;
    });
  };

  const handleGenerate = async () => {
    setGenerateError("");
    setGenerateSuccess("");

    if (!modelName.trim()) {
      setGenerateError("Enter a model name.");
      return;
    }
    if (!reqId.trim() || !matched || matched.length === 0) {
      setGenerateError("Select a requirement ID with matching testcases.");
      return;
    }

    const requirementDescription = matched
      .map(
        (tc) =>
          `${tc.testCaseId} - ${tc.title}: ${tc.objective} (Pass/Fail: ${tc.passFailCriteria})`
      )
      .join("\n");

    const portNames = buses
      .flatMap((bus) => bus.ports.map((port) => port.name.trim()).filter(Boolean));

    setIsGenerating(true);
    try {
      const res = await fetch("/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelName: modelName.trim(),
          requirementId: reqId.trim(),
          requirementDescription,
          ports: portNames,
          count: matched.length || 5,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Request failed with status ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `MBD_TestSuite_${reqId.trim().replace(/[^a-zA-Z0-9._-]/g, "_")}.m`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setGenerateSuccess(`Downloaded: MBD_TestSuite_${reqId.trim()}.m`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Generation failed.";
      setGenerateError(msg);
    } finally {
      setIsGenerating(false);
    }
  };

  const hasFile = !!fileName && !parseError;
  const canSearch = hasFile;

  return (
    <div className="min-h-[100dvh] bg-[#0b0f19] text-slate-100 flex flex-col">
      <Navbar />

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Config */}
          <div className="lg:col-span-7 space-y-4">
            {/* Top bar: model name + upload */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Model Name
                  </label>
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="e.g. ESC_System_Controller"
                    className={inputCls}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Workbook
                  </label>
                  {!fileName ? (
                    <label
                      onDrop={handleDrop}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDraggingOver(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        setIsDraggingOver(false);
                      }}
                      className={`flex items-center gap-2.5 rounded-lg border-2 border-dashed px-3 py-2 cursor-pointer transition-all text-sm ${
                        isDraggingOver
                          ? "border-blue-500 bg-blue-500/10"
                          : "border-slate-700 bg-slate-800 hover:border-slate-600"
                      }`}
                    >
                      <Upload className="h-4 w-4 text-slate-400 shrink-0" />
                      <span className="text-slate-300 truncate">Drop .xlsx or click</span>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleFileInputChange}
                        className="hidden"
                      />
                    </label>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2">
                      <FileSpreadsheet className="h-4 w-4 text-blue-400 shrink-0" />
                      <span className="text-sm text-blue-300 truncate flex-1">{fileName}</span>
                      <span className="text-xs text-emerald-400 font-mono shrink-0">
                        {allTestCases.length} tc
                      </span>
                      <button
                        onClick={clearFile}
                        className="text-slate-400 hover:text-white transition shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {parseError && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {parseError}
                </div>
              )}
            </div>

            {/* Requirement search + chips */}
            {canSearch && (
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

                {uniqueReqIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
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
                )}
              </div>
            )}

            {/* Buses */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Simulink Inports (Buses)
                </label>
                <span className="text-xs text-slate-500 font-mono">
                  {buses.length} bus{buses.length === 1 ? "" : "es"}
                </span>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <input
                  type="number"
                  min={0}
                  value={numBuses}
                  onChange={(e) => handleBusCountChange(e.target.value)}
                  placeholder="0"
                  className={inputCls + " w-20"}
                />
                <button
                  onClick={() =>
                    handleBusCountChange(String(Math.max(0, (parseInt(numBuses, 10) || 0) - 1)))
                  }
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition active:scale-95"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() =>
                    handleBusCountChange(String((parseInt(numBuses, 10) || 0) + 1))
                  }
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition active:scale-95"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {buses.length > 0 && (
                <div className="space-y-3">
                  {buses.map((bus, bi) => (
                    <div key={bi} className="rounded-lg border border-slate-800 bg-slate-800/50 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                        <span className="text-xs font-medium text-slate-300">Bus {bi + 1}</span>
                        <span className="text-slate-600 text-xs">·</span>
                        <span className="text-[11px] text-slate-500">Ports:</span>
                        <input
                          type="number"
                          min={0}
                          value={bus.portCount ?? ""}
                          onChange={(e) => handleBusPortCountChange(bi, e.target.value)}
                          placeholder="0"
                          className="w-14 rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs font-mono text-slate-200 text-center focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                      {bus.ports.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {bus.ports.map((port, pi) => (
                            <input
                              key={pi}
                              type="text"
                              value={port.name}
                              onChange={(e) => handleBusPortChange(bi, pi, e.target.value)}
                              placeholder={`Port ${pi + 1}`}
                              className="rounded-md border border-slate-700/60 bg-slate-900/60 px-2 py-1 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Generate */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">Generate Test Suite</p>
                  <p className="text-xs text-slate-500">Downloads a .m MATLAB script</p>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none shrink-0"
                >
                  {isGenerating ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Generate
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

          {/* Right: Testcase matrix */}
          <div className="lg:col-span-5">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 min-h-[400px] flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Testcase Preview
                </h2>
                {matched !== null && (
                  <span className="text-xs font-mono text-blue-400">
                    {matched.length} result{matched.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              {matched === null ? (
                <div className="flex-1 flex items-center justify-center text-center px-6">
                  <div>
                    <p className="text-sm text-slate-500">Search a requirement to preview testcases</p>
                    <p className="text-xs text-slate-600 mt-1">
                      {allTestCases.length > 0
                        ? `${allTestCases.length} cases loaded from workbook`
                        : "Upload a workbook to get started"}
                    </p>
                  </div>
                </div>
              ) : matched.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-center px-6">
                  <div>
                    <p className="text-sm text-amber-400">No matches</p>
                    <p className="text-xs text-slate-500 mt-1">
                      "{reqId}" not found in the workbook
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 overflow-y-auto max-h-[640px] pr-1">
                  {matched.map((tc, i) => (
                    <div
                      key={tc.testCaseId || i}
                      className="rounded-lg border border-slate-800 bg-slate-800/40 p-3 hover:border-slate-700 transition"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div>
                          <span className="font-mono text-xs font-semibold text-blue-400">
                            {tc.testCaseId}
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
                          {tc.status && (
                            <span
                              className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                tc.status.toLowerCase() === "pass"
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : tc.status.toLowerCase() === "fail"
                                  ? "bg-red-500/15 text-red-400"
                                  : "bg-slate-700/50 text-slate-400"
                              }`}
                            >
                              {tc.status.toLowerCase() === "pass" && <Check className="w-2.5 h-2.5" />}
                              {tc.status}
                            </span>
                          )}
                        </div>
                      </div>

                      {tc.objective && (
                        <p className="text-[11px] text-slate-400 leading-relaxed mt-1.5 line-clamp-3">
                          {tc.objective}
                        </p>
                      )}

                      {tc.passFailCriteria && (
                        <p className="text-[11px] text-slate-500 font-mono mt-1.5 line-clamp-2">
                          {tc.passFailCriteria}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}