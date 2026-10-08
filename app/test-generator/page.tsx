"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import {
  Upload,
  FileSpreadsheet,
  FileJson,
  X,
  Search,
  CheckCircle2,
  AlertCircle,
  ListChecks,
  Cable,
  Code2,
  Copy,
  Check,
  Download,
  Eye,
  Sliders,
  Layers,
} from "lucide-react";
import Navbar from "../components/Navbar";
import { parseExcelWorkbook, type ParsedTestCase } from "@/lib/excelParser";
import {
  parseInterfaceWorkbook,
  type ModelInterface,
  cleanInterfaceForExport,
  createEmptyInterface,
  validateInterface,
} from "@/lib/interfaceExcelParser";
import InterfaceEditor from "./InterfaceEditor";
import {
  type StandardizedTestCase,
} from "@/lib/standardizer-types";
import * as XLSX from "xlsx";

/* ─── Styling Helpers ─────────────────────────────────────────── */

const inputCls =
  "w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 font-mono placeholder:text-slate-500 transition focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50";

const btnSecondary =
  "inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white active:bg-slate-900";

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

export interface PreparedLLMInputPayload {
  modelName: string;
  configConstants?: string;
  requirementScope: {
    mode: "selected" | "all";
    selectedIds?: string[];
    requirementIds: string[];
    totalRequirementsCount: number;
    testCaseCount: number;
  };
  testCases: {
    id: string;
    requirementId: string;
    title: string;
    objective: string;
    preconditions?: string;
    passFailCriteria?: string;
    priority?: string;
    notes?: string;
  }[];
  interface: {
    totalInputs: number;
    totalOutputs: number;
    inputPortNames: string[];
    outputPortNames: string[];
    flatPortSpecs: {
      name: string;
      ioRole: "Input" | "Output";
      datatype?: string;
      dimensions?: number[] | string | null;
      signalType?: string;
      enumValues?: string;
    }[];
    hierarchy?: Record<string, unknown>;
  };
}

/* ─── Component ───────────────────────────────────────────────── */

export default function TestGeneratorPage() {
  // Requirements state
  const [reqFileName, setReqFileName] = useState("");
  const [allTestCases, setAllTestCases] = useState<NormalizedTestCase[]>([]);
  const [reqParseError, setReqParseError] = useState("");

  // Interface state
  const [interfaceFileName, setInterfaceFileName] = useState("");
  const [interfaceState, setInterfaceState] = useState<ModelInterface | null>(null);
  const [interfaceParseError, setInterfaceParseError] = useState("");
  const [interfaceParseWarning, setInterfaceParseWarning] = useState("");
  const [interfaceConfirmed, setInterfaceConfirmed] = useState(false);
  const [finalInterfaceJson, setFinalInterfaceJson] = useState<Record<string, unknown> | null>(null);

  // Model & selection
  const [modelName, setModelName] = useState("ESC_Stability_Controller");
  const [configConstants, setConfigConstants] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedReqIds, setSelectedReqIds] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);

  // UI State for payload viewer
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [activeTab, setActiveTab] = useState<"preview" | "payload" | "flow" | "matlab">("preview");

  // Generation State
  const [isGeneratingFlow, setIsGeneratingFlow] = useState(false);
  const [generatedFlow, setGeneratedFlow] = useState<any[] | null>(null);
  const [flowError, setFlowError] = useState("");
  
  const [isGeneratingMatlab, setIsGeneratingMatlab] = useState(false);
  const [generatedMatlab, setGeneratedMatlab] = useState("");
  const [matlabError, setMatlabError] = useState("");

  // Drag states
  const [isDraggingReqs, setIsDraggingReqs] = useState(false);
  const [isDraggingInterface, setIsDraggingInterface] = useState(false);
  const [isDraggingConfig, setIsDraggingConfig] = useState(false);
  const [configFileName, setConfigFileName] = useState("");

  const reqFileInputRef = useRef<HTMLInputElement>(null);
  const interfaceFileInputRef = useRef<HTMLInputElement>(null);

  /* ─── Derived values ─────────────────────────────────────── */

  const uniqueReqIds = useMemo(() => {
    const ids = new Set<string>();
    allTestCases.forEach((tc) => {
      const id = tc.requirementId.trim();
      if (id) ids.add(id);
    });
    return Array.from(ids);
  }, [allTestCases]);

  const flatPorts = useMemo(() => {
    if (!interfaceState) return { inputs: [], outputs: [], all: [] };
    const inputs: {
      name: string;
      ioRole: "Input";
      datatype?: string;
      dimensions?: number[] | string | null;
      signalType?: string;
      enumValues?: string;
    }[] = [];
    const outputs: {
      name: string;
      ioRole: "Output";
      datatype?: string;
      dimensions?: number[] | string | null;
      signalType?: string;
      enumValues?: string;
    }[] = [];

    // Inputs
    interfaceState.inputs.ports.forEach((p) => {
      inputs.push({
        name: p.name,
        ioRole: "Input",
        datatype: p.data_type,
        dimensions: p.dimensions,
        signalType: p.signal_type,
        enumValues: p.enum_values ?? p.enum_class,
      });
    });
    interfaceState.inputs.buses.forEach((b) => {
      inputs.push({ name: b.name, ioRole: "Input", datatype: "bus" });
    });

    // Outputs
    interfaceState.outputs.ports.forEach((p) => {
      outputs.push({
        name: p.name,
        ioRole: "Output",
        datatype: p.data_type,
        dimensions: p.dimensions,
        signalType: p.signal_type,
        enumValues: p.enum_values ?? p.enum_class,
      });
    });
    interfaceState.outputs.buses.forEach((b) => {
      outputs.push({ name: b.name, ioRole: "Output", datatype: "bus" });
    });

    return { inputs, outputs, all: [...inputs, ...outputs] };
  }, [interfaceState]);

  const inputPorts = flatPorts.inputs;
  const outputPorts = flatPorts.outputs;

  const totalCount = allTestCases.length;

  const activeTestCases = useMemo(() => {
    if (showAll) return allTestCases;
    if (selectedReqIds.length > 0) {
      return allTestCases.filter((tc) =>
        selectedReqIds.includes(tc.requirementId.trim())
      );
    }
    return [];
  }, [showAll, allTestCases, selectedReqIds]);

  // Structured LLM Input Payload that captures everything fed into LLM
  const preparedLLMPayload: PreparedLLMInputPayload = useMemo(() => {
    const portSpecs = flatPorts.all.map((p) => ({
      name: p.name,
      ioRole: p.ioRole as "Input" | "Output",
      datatype: p.datatype,
      dimensions: p.dimensions,
      signalType: p.signalType,
      enumValues: p.enumValues,
    }));

    const structuredTestCases = activeTestCases.map((tc) => ({
      id: tc.id,
      requirementId: tc.requirementId,
      title: tc.title,
      objective: tc.objective,
      preconditions: tc.preconditions || undefined,
      passFailCriteria: tc.passFailCriteria || undefined,
      priority: tc.priority || undefined,
      notes: tc.notes || undefined,
    }));

    const cleanedHierarchy = finalInterfaceJson ?? (interfaceState ? cleanInterfaceForExport(interfaceState) : undefined);

    return {
      modelName: modelName.trim(),
      configConstants: configConstants.trim() || undefined,
      requirementScope: {
        mode: showAll ? "all" : "selected",
        selectedIds: showAll ? undefined : selectedReqIds,
        requirementIds: showAll ? uniqueReqIds : selectedReqIds,
        totalRequirementsCount: showAll ? uniqueReqIds.length : selectedReqIds.length,
        testCaseCount: structuredTestCases.length,
      },
      testCases: structuredTestCases,
      interface: {
        totalInputs: inputPorts.length,
        totalOutputs: outputPorts.length,
        inputPortNames: inputPorts.map((p) => p.name),
        outputPortNames: outputPorts.map((p) => p.name),
        flatPortSpecs: portSpecs,
        hierarchy: cleanedHierarchy as Record<string, unknown> | undefined,
      },
    };
  }, [
    modelName,
    configConstants,
    showAll,
    selectedReqIds,
    uniqueReqIds,
    activeTestCases,
    flatPorts.all,
    inputPorts,
    outputPorts,
    finalInterfaceJson,
    interfaceState,
  ]);

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
    setSearchQuery("");
    setSelectedReqIds([]);
    setShowAll(false);

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
    setSearchQuery("");
    setSelectedReqIds([]);
    setShowAll(false);
    setReqParseError("");
  };

  /* ─── Interface file handling ────────────────────────────── */

  const processInterfaceFile = useCallback(async (file: File) => {
    setInterfaceParseError("");
    setInterfaceParseWarning("");
    setInterfaceFileName("");
    setInterfaceState(null);
    setInterfaceConfirmed(false);
    setFinalInterfaceJson(null);

    const ext = file.name.split(".").pop()?.toLowerCase();

    try {
      if (ext === "xlsx" || ext === "xls") {
        const buffer = await file.arrayBuffer();
        const result = parseInterfaceWorkbook(buffer);
        if (result.totalInputs === 0 && result.totalOutputs === 0) {
          setInterfaceParseError(
            result.warnings[0] || "No Input or Output signals/buses found in workbook."
          );
          setInterfaceFileName("");
          return;
        }
        if (result.warnings.length > 0) {
          setInterfaceParseWarning(result.warnings.join(" "));
        }
        setInterfaceState(result.interfaceData);
        setInterfaceFileName(file.name);
      } else {
        setInterfaceParseError("Unsupported file type. Use .xlsx or .xls files.");
      }
    } catch {
      setInterfaceParseError("Failed to parse file. Ensure it is a valid Excel file.");
    }
  }, []);

  const handleInterfaceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processInterfaceFile(file);
    e.target.value = "";
  };

  const handleInterfaceDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingInterface(false);
      const file = e.dataTransfer.files[0];
      if (file) processInterfaceFile(file);
    },
    [processInterfaceFile]
  );

  const clearInterface = () => {
    setInterfaceFileName("");
    setInterfaceState(null);
    setInterfaceParseError("");
    setInterfaceParseWarning("");
    setInterfaceConfirmed(false);
    setFinalInterfaceJson(null);
  };

  const handleConfirmInterface = () => {
    if (!interfaceState) return;
    const validation = validateInterface(interfaceState);
    if (!validation.isValid) {
      setInterfaceParseError("Please fix validation errors before confirming interface.");
      return;
    }
    const cleanJson = cleanInterfaceForExport(interfaceState);
    setFinalInterfaceJson(cleanJson);
    setInterfaceConfirmed(true);
    setInterfaceParseError("");
  };

  /* ─── Configuration Constants file handling ──────────────── */

  const processConfigFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "xlsx" && ext !== "xls") {
      alert("Please upload a valid Excel file (.xlsx or .xls)");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Convert to JSON, array of arrays
      const jsonData = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
      
      let constantsText = "";
      for (const row of jsonData) {
        if (Array.isArray(row) && row.length >= 1) {
          const name = String(row[0] || "").trim();
          if (name) {
            constantsText += `${name}\n`;
          }
        }
      }

      setConfigConstants(constantsText.trim());
      setConfigFileName(file.name);
    } catch (error) {
      console.error("Failed to parse config file:", error);
      alert("Failed to parse the configuration constants file.");
    }
  }, []);

  const handleConfigFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processConfigFile(file);
    e.target.value = "";
  };

  const handleConfigDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingConfig(false);
      const file = e.dataTransfer.files[0];
      if (file) processConfigFile(file);
    },
    [processConfigFile]
  );

  /* ─── Requirement selection ──────────────────────────────── */

  const handleReqIdToggle = (id: string) => {
    if (showAll) {
      setShowAll(false);
      setSelectedReqIds([id]);
      return;
    }
    setSelectedReqIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    setSearchQuery("");
    setSelectedReqIds([]);
    setShowAll(true);
  };

  const handleCopyPayload = () => {
    navigator.clipboard.writeText(JSON.stringify(preparedLLMPayload, null, 2));
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  const handleDownloadPayload = () => {
    const jsonStr = JSON.stringify(preparedLLMPayload, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeModel = (modelName.trim() || "Model").replace(/[^a-zA-Z0-9_-]/g, "_");
    const scopeStr = showAll ? "ALL_REQS" : (selectedReqIds.length > 0 ? selectedReqIds.join("_").replace(/[^a-zA-Z0-9_-]/g, "_") : "NO_SCOPE");
    a.download = `LLM_Input_Payload_${safeModel}_${scopeStr}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /* ─── Generation Handlers ────────────────────────────────── */

  const handleGenerateFlow = async () => {
    if (activeTestCases.length === 0) {
      setFlowError("No test cases selected.");
      return;
    }
    
    setIsGeneratingFlow(true);
    setFlowError("");
    setGeneratedFlow(null);
    setActiveTab("flow");

    try {
      const res = await fetch("/api/generate-flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preparedLLMPayload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate flow");

      setGeneratedFlow(data.flow);
    } catch (err: any) {
      setFlowError(err.message);
    } finally {
      setIsGeneratingFlow(false);
    }
  };

  const handleGenerateMatlab = async () => {
    if (!generatedFlow) {
      setMatlabError("No verified test case flow available.");
      return;
    }

    setIsGeneratingMatlab(true);
    setMatlabError("");
    setGeneratedMatlab("");
    setActiveTab("matlab");

    try {
      const res = await fetch("/api/generate-matlab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow: generatedFlow,
          interface: preparedLLMPayload.interface,
          configConstants: preparedLLMPayload.configConstants,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate MATLAB script");

      setGeneratedMatlab(data.script);
    } catch (err: any) {
      setMatlabError(err.message);
    } finally {
      setIsGeneratingMatlab(false);
    }
  };

  /* ─── Render ─────────────────────────────────────────────── */

  const hasReqs = allTestCases.length > 0;
  const hasPorts = (inputPorts.length > 0 || outputPorts.length > 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-8">
        {/* Page Header */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-400">
              <Code2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Test Generator - Input Feeder & Staging
              </h1>
              <p className="mt-0.5 text-xs text-slate-400">
                Feed standardized test requirements and Simulink I/O interfaces to stage the exact payload for LLM processing.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab(activeTab === "preview" ? "payload" : "preview")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition"
            >
              {activeTab === "preview" ? (
                <>
                  <Sliders className="h-3.5 w-3.5 text-blue-400" />
                  Inspect LLM Staged Payload
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5 text-emerald-400" />
                  View Test Cases ({activeTestCases.length})
                </>
              )}
            </button>
          </div>
        </div>

        {/* ─── MAIN 2-COLUMN GRID ─────────────────────────────── */}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* LEFT COLUMN: Inputs (5 Cols) */}
          <div className="lg:col-span-5 space-y-4">
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

            {/* Configuration Constants */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Configuration Constants
                </label>
              </div>

              {!configFileName ? (
                <label
                  onDrop={handleConfigDrop}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingConfig(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDraggingConfig(false);
                  }}
                  className={`flex items-center gap-2.5 rounded-lg border-2 border-dashed px-3 py-3 cursor-pointer transition-all text-sm mb-3 ${
                    isDraggingConfig
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-slate-700 bg-slate-800 hover:border-slate-600"
                  }`}
                >
                  <Upload className="h-4 w-4 text-slate-400 shrink-0" />
                  <span className="text-slate-300">
                    Drop Constants Excel (.xlsx, .xls)
                  </span>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleConfigFileChange}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 mb-3">
                  <FileSpreadsheet className="h-4 w-4 text-blue-400 shrink-0" />
                  <span className="text-sm text-blue-300 truncate flex-1 font-mono">
                    {configFileName}
                  </span>
                  <button
                    onClick={() => {
                      setConfigFileName("");
                      setConfigConstants("");
                    }}
                    className="text-slate-400 hover:text-white transition shrink-0 p-1"
                    title="Clear file"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <textarea
                value={configConstants}
                onChange={(e) => setConfigConstants(e.target.value)}
                placeholder="e.g. K_MAX_SPEED&#10;K_MIN_SPEED"
                className={inputCls + " min-h-[80px] resize-y"}
              />
            </div>

            {/* Requirements Upload */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                  Test Requirements Document
                </label>
                {hasReqs && (
                  <span className="text-xs text-emerald-400 font-mono">
                    {totalCount} cases · {uniqueReqIds.length} reqs
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
                    Drop .xlsx (Standardized) or .json
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
                  <span className="text-sm text-blue-300 truncate flex-1 font-mono">
                    {reqFileName}
                  </span>
                  <span className="text-xs text-emerald-400 font-mono shrink-0">
                    {totalCount} tc
                  </span>
                  <button
                    onClick={clearReqs}
                    className="text-slate-400 hover:text-white transition shrink-0 p-1"
                    title="Clear file"
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
                  Parsed: Standardized Excel or JSON with objectives, preconditions & pass/fail criteria.
                </p>
              )}
            </div>

            {/* Requirement Scope Selector */}
            {hasReqs && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    Requirement Scope
                  </label>
                  <span className="text-[11px] text-blue-400 font-mono">
                    {activeTestCases.length} case{activeTestCases.length === 1 ? "" : "s"} active
                  </span>
                </div>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search requirement IDs..."
                    className={inputCls + " pl-9 pr-8"}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto pr-1">
                  <button
                    onClick={handleSelectAll}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-all inline-flex items-center gap-1 ${
                      showAll
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                    }`}
                  >
                    <ListChecks className="h-3 w-3" />
                    All ({totalCount})
                  </button>
                  {uniqueReqIds
                    .filter((id) =>
                      id.toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((id) => (
                      <button
                        key={id}
                        onClick={() => handleReqIdToggle(id)}
                        className={`rounded-md px-2 py-1 text-xs font-mono transition-all ${
                          selectedReqIds.includes(id) && !showAll
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

            {/* Input/Output Document (Model Interface) */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Cable className="h-4 w-4 text-blue-400" />
                  <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    Simulink I/O Interface
                  </label>
                </div>
                {interfaceState && (
                  <div className="flex items-center gap-2">
                    {interfaceConfirmed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="h-3 w-3" /> Confirmed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400 border border-amber-500/20">
                        Unconfirmed
                      </span>
                    )}
                    <span className="text-xs text-slate-500 font-mono">
                      {inputPorts.length} in · {outputPorts.length} out
                    </span>
                  </div>
                )}
              </div>

              {!interfaceFileName && !interfaceState ? (
                <div className="space-y-3">
                  <label
                    onDrop={handleInterfaceDrop}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDraggingInterface(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setIsDraggingInterface(false);
                    }}
                    className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 cursor-pointer transition-all text-sm ${
                      isDraggingInterface
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-slate-700 bg-slate-800 hover:border-slate-600 hover:bg-slate-800/80"
                    }`}
                  >
                    <Upload className="h-6 w-6 text-slate-400 mb-2" />
                    <span className="text-sm font-medium text-slate-200">
                      Drop Interface Excel (.xlsx, .xls)
                    </span>
                    <span className="text-xs text-slate-500 mt-1 text-center">
                      Auto-detects buses, nested hierarchy, ports, datatypes, dimensions & signal types
                    </span>
                    <input
                      ref={interfaceFileInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleInterfaceFileChange}
                      className="hidden"
                    />
                  </label>
                  <div className="flex items-center justify-between text-xs px-1">
                    <span className="text-slate-500">Don&apos;t have an Excel file?</span>
                    <button
                      type="button"
                      onClick={() => {
                        setInterfaceState(createEmptyInterface());
                        setInterfaceFileName("Manual Interface Definition");
                      }}
                      className="text-blue-400 hover:text-blue-300 hover:underline transition font-medium"
                    >
                      + Create Interface from Scratch
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2">
                    <FileSpreadsheet className="h-4 w-4 text-blue-400 shrink-0" />
                    <span className="text-sm text-blue-300 truncate flex-1 font-mono">
                      {interfaceFileName || "Custom Interface"}
                    </span>
                    <button
                      onClick={clearInterface}
                      className="text-slate-400 hover:text-white transition shrink-0 p-1"
                      title="Clear interface"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {interfaceParseError && (
                    <div className="flex items-center gap-1.5 text-xs text-red-400 bg-red-950/20 p-2.5 rounded-lg border border-red-800/30">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {interfaceParseError}
                    </div>
                  )}

                  {interfaceParseWarning && !interfaceParseError && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-950/20 p-2.5 rounded-lg border border-amber-800/30">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {interfaceParseWarning}
                    </div>
                  )}

                  {interfaceState && (
                    <InterfaceEditor
                      interfaceState={interfaceState}
                      onChange={(newState) => {
                        setInterfaceState(newState);
                        setInterfaceConfirmed(false);
                      }}
                      onConfirm={handleConfirmInterface}
                      isConfirmed={interfaceConfirmed}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Generate Flow Button */}
            <div className="pt-4">
              <button
                onClick={handleGenerateFlow}
                disabled={isGeneratingFlow || activeTestCases.length === 0}
                className={`w-full py-3 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                  isGeneratingFlow || activeTestCases.length === 0
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20"
                }`}
              >
                {isGeneratingFlow ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Generating Stage 1: Test Case Flow...
                  </>
                ) : (
                  <>
                    <Code2 className="h-4 w-4" />
                    Generate Stage 1: Test Case Flow
                  </>
                )}
              </button>
              {flowError && (
                <p className="mt-2 text-xs text-red-400 text-center">{flowError}</p>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Output Staging & Inspector (7 Cols) */}
          <div className="lg:col-span-7 space-y-4">
            {/* Header Tabs */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setActiveTab("preview")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                    activeTab === "preview"
                      ? "bg-blue-600/20 text-blue-300 border border-blue-500/30"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Active Test Cases ({activeTestCases.length})
                </button>
                <button
                  onClick={() => setActiveTab("payload")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                    activeTab === "payload"
                      ? "bg-purple-600/20 text-purple-300 border border-purple-500/30"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  LLM Payload
                </button>
                <button
                  onClick={() => setActiveTab("flow")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                    activeTab === "flow"
                      ? "bg-amber-600/20 text-amber-300 border border-amber-500/30"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  <ListChecks className="h-3 w-3" />
                  Stage 1: Flow
                </button>
                <button
                  onClick={() => setActiveTab("matlab")}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                    activeTab === "matlab"
                      ? "bg-emerald-600/20 text-emerald-300 border border-emerald-500/30"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  <Code2 className="h-3 w-3" />
                  Stage 2: MATLAB
                </button>
              </div>

              {activeTab === "payload" && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyPayload}
                    className={btnSecondary}
                    title="Copy staged payload JSON"
                  >
                    {copiedPayload ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy JSON
                      </>
                    )}
                  </button>
                  <button
                    onClick={handleDownloadPayload}
                    className={btnSecondary}
                    title="Download staged payload JSON"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download JSON
                  </button>
                </div>
              )}
            </div>

            {/* Tab 1: Active Test Cases Preview */}
            {activeTab === "preview" && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    {showAll ? "All Test Cases" : selectedReqIds.length > 0 ? `Test Cases for ${selectedReqIds.join(", ")}` : "Test Case Preview"}
                  </h2>
                  {activeTestCases.length > 0 && (
                    <span className="text-xs font-mono text-blue-400">
                      {activeTestCases.length} case{activeTestCases.length === 1 ? "" : "s"} staged
                    </span>
                  )}
                </div>

                {!hasReqs ? (
                  <div className="flex min-h-[300px] flex-col items-center justify-center text-center px-6">
                    <Upload className="h-10 w-10 text-slate-700 mb-3" />
                    <p className="text-sm text-slate-400 font-medium">No Requirements Loaded</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm">
                      Upload a standardized test requirement Excel file or JSON to inspect test cases and stage them for LLM ingestion.
                    </p>
                  </div>
                ) : activeTestCases.length === 0 ? (
                  <div className="flex min-h-[300px] flex-col items-center justify-center text-center px-6">
                    <p className="text-sm text-amber-400 font-medium">No matching test cases</p>
                    <p className="text-xs text-slate-500 mt-1">
                      No test cases matched the selected requirements. Select an existing requirement from the list on the left.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 overflow-y-auto max-h-[600px] pr-1">
                    {activeTestCases.map((tc, idx) => (
                      <div
                        key={`${tc.id}-${idx}`}
                        className="rounded-lg border border-slate-800 bg-slate-800/40 p-3.5 hover:border-slate-700 transition"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-blue-400">
                                {tc.id}
                              </span>
                              <span className="text-[10px] font-mono bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">
                                {tc.requirementId}
                              </span>
                            </div>
                            <p className="text-xs font-medium text-slate-200 mt-1">
                              {tc.title || "Untitled Test Case"}
                            </p>
                          </div>
                          {tc.priority && (
                            <span
                              className={`text-[10px] font-medium px-2 py-0.5 rounded shrink-0 ${
                                tc.priority.toLowerCase() === "high"
                                  ? "bg-red-500/15 text-red-400 border border-red-500/20"
                                  : tc.priority.toLowerCase() === "medium"
                                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                                  : "bg-slate-700/50 text-slate-400"
                              }`}
                            >
                              {tc.priority}
                            </span>
                          )}
                        </div>

                        {tc.objective && (
                          <div className="mt-2 text-xs text-slate-300">
                            <span className="text-[10px] font-semibold uppercase text-slate-500 block mb-0.5">Objective</span>
                            <p className="text-slate-300 leading-relaxed bg-slate-900/60 p-2 rounded border border-slate-800/80 font-mono text-[11px]">
                              {tc.objective}
                            </p>
                          </div>
                        )}

                        {tc.preconditions && (
                          <div className="mt-2 text-xs text-slate-400">
                            <span className="text-[10px] font-semibold uppercase text-slate-500 block mb-0.5">Preconditions</span>
                            <p className="text-slate-400 leading-relaxed text-[11px]">
                              {tc.preconditions}
                            </p>
                          </div>
                        )}

                        {tc.passFailCriteria && (
                          <div className="mt-2 text-xs text-slate-400">
                            <span className="text-[10px] font-semibold uppercase text-emerald-500/80 block mb-0.5">Pass/Fail Criteria</span>
                            <p className="text-emerald-400/90 leading-relaxed text-[11px] font-mono">
                              {tc.passFailCriteria}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Staged LLM Payload Inspector */}
            {activeTab === "payload" && (
              <div className="rounded-xl border border-purple-900/30 bg-slate-900/80 p-4 space-y-4">
                {/* Summary Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg bg-slate-800/60 border border-slate-700/60 p-2.5">
                    <span className="text-[10px] uppercase font-semibold text-slate-400 block">Model</span>
                    <span className="text-xs font-mono font-bold text-blue-300 truncate block">
                      {preparedLLMPayload.modelName || "(empty)"}
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-800/60 border border-slate-700/60 p-2.5">
                    <span className="text-[10px] uppercase font-semibold text-slate-400 block">Scope</span>
                    <span className="text-xs font-mono font-bold text-purple-300 truncate block">
                      {preparedLLMPayload.requirementScope.mode === "all"
                        ? `All (${preparedLLMPayload.requirementScope.totalRequirementsCount} Reqs)`
                        : preparedLLMPayload.requirementScope.selectedIds?.join(", ") || "None"}
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-800/60 border border-slate-700/60 p-2.5">
                    <span className="text-[10px] uppercase font-semibold text-slate-400 block">Staged Cases</span>
                    <span className="text-xs font-mono font-bold text-emerald-300 block">
                      {preparedLLMPayload.testCases.length}
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-800/60 border border-slate-700/60 p-2.5">
                    <span className="text-[10px] uppercase font-semibold text-slate-400 block">Interface Ports</span>
                    <span className="text-xs font-mono font-bold text-amber-300 block">
                      {preparedLLMPayload.interface.totalInputs} in / {preparedLLMPayload.interface.totalOutputs} out
                    </span>
                  </div>
                </div>

                {/* JSON Viewer */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                      Prepared JSON Object (What LLM Receives)
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {JSON.stringify(preparedLLMPayload).length.toLocaleString()} characters
                    </span>
                  </div>
                  <pre className="max-h-[520px] overflow-auto whitespace-pre rounded-lg bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-300 border border-slate-800">
                    {JSON.stringify(preparedLLMPayload, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* Tab 3: Stage 1 Flow */}
            {activeTab === "flow" && (
              <div className="rounded-xl border border-amber-900/30 bg-slate-900/80 p-4 space-y-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    Stage 1: Verified Test Case Flow
                  </h2>
                  {generatedFlow && (
                    <button
                      onClick={handleGenerateMatlab}
                      disabled={isGeneratingMatlab}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                        isGeneratingMatlab
                          ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                          : "bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-900/20"
                      }`}
                    >
                      {isGeneratingMatlab ? (
                        <>
                          <div className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Generating MATLAB...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Approve & Generate MATLAB
                        </>
                      )}
                    </button>
                  )}
                </div>

                {!generatedFlow ? (
                  <div className="flex min-h-[300px] flex-col items-center justify-center text-center px-6">
                    <ListChecks className="h-10 w-10 text-slate-700 mb-3" />
                    <p className="text-sm text-slate-400 font-medium">No Flow Generated</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm">
                      Click "Generate Stage 1: Test Case Flow" to analyze the requirements and create the structured test flow.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {matlabError && (
                      <div className="flex items-center gap-1.5 text-xs text-red-400 bg-red-950/20 p-2.5 rounded-lg border border-red-800/30">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {matlabError}
                      </div>
                    )}
                    <pre className="max-h-[600px] overflow-auto whitespace-pre rounded-lg bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-slate-300 border border-slate-800">
                      {JSON.stringify(generatedFlow, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Tab 4: Stage 2 MATLAB */}
            {activeTab === "matlab" && (
              <div className="rounded-xl border border-emerald-900/30 bg-slate-900/80 p-4 space-y-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    Stage 2: Generated MATLAB Script
                  </h2>
                  {generatedMatlab && (
                    <button
                      onClick={() => {
                        const blob = new Blob([generatedMatlab], { type: "text/plain" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `Test_${modelName.replace(/[^a-zA-Z0-9_-]/g, "_")}.m`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                      }}
                      className={btnSecondary}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download .m File
                    </button>
                  )}
                </div>

                {!generatedMatlab ? (
                  <div className="flex min-h-[300px] flex-col items-center justify-center text-center px-6">
                    <Code2 className="h-10 w-10 text-slate-700 mb-3" />
                    <p className="text-sm text-slate-400 font-medium">No MATLAB Script Generated</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm">
                      Approve the Test Case Flow in Stage 1 to generate the final MATLAB script.
                    </p>
                  </div>
                ) : (
                  <pre className="max-h-[600px] overflow-auto whitespace-pre rounded-lg bg-slate-950 p-4 font-mono text-[11px] leading-relaxed text-emerald-400 border border-slate-800">
                    {generatedMatlab}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
