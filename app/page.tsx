"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, Search, X, CheckCircle2 } from "lucide-react";
import Navbar from "./components/Navbar";

// Column layout used across the testcase sheets in this workbook:
// [Test case ID, Requirement ID, Title, Objective, Preconditions, ts (s), Pass/Fail Criteria, Priority, Status, Notes]
const FIELD_ORDER = [
  "testCaseId",
  "requirementId",
  "title",
  "objective",
  "preconditions",
  "ts",
  "passFailCriteria",
  "priority",
  "status",
  "notes",
];

function parseWorkbook(arrayBuffer : ArrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const testCases = [];

  wb.SheetNames.forEach((sheetName) => {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    if (!rows || rows.length < 2) return;

    // Only treat sheets that look like testcase tables (first cell of header is "Test case ID")
    const header = rows[0];
    if (!header || typeof header[0] !== "string" || !header[0].toLowerCase().includes("test case id")) {
      return;
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const tcId = row[0];
      // Skip requirement-header grouping rows (e.g. "REQ-..." with nothing else on the row)
      if (typeof tcId !== "string" || !tcId.toUpperCase().startsWith("TC-")) continue;

      const entry = { sheet: sheetName };
      FIELD_ORDER.forEach((key, idx) => {
        entry[key] = row[idx] !== undefined && row[idx] !== null ? String(row[idx]) : "";
      });
      console.log("Parsing row:", entry);
      testCases.push(entry);
    }
  });

  return testCases;
}

export default function TestRequirementForm() {
  const [modelName, setModelName] = useState("");
  const [fileName, setFileName] = useState("");
  const [allTestCases, setAllTestCases] = useState([]);
  const [parseError, setParseError] = useState("");
  const [numPorts, setNumPorts] = useState(0);
  const [ports, setPorts] = useState([]);
  const [reqId, setReqId] = useState("");
  const [matched, setMatched] = useState(null); // null = not searched yet

  // --- Generation state ---
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateSuccess, setGenerateSuccess] = useState("");

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError("");
    setMatched(null);
    setReqId("");
    setGenerateError("");
    setGenerateSuccess("");

    try {
      const buffer = await file.arrayBuffer();
      const testCases = parseWorkbook(buffer);
      if (testCases.length === 0) {
        setParseError("No testcases found in this file. Check that it has a 'Test case ID' column.");
        setAllTestCases([]);
        setFileName("");
        return;
      }
      setAllTestCases(testCases);
      setFileName(file.name);
    } catch (err) {
      console.error(err);
      setParseError("Couldn't read that file. Make sure it's a valid .xlsx workbook.");
      setAllTestCases([]);
      setFileName("");
    }
  };

  const clearFile = () => {
    setFileName("");
    setAllTestCases([]);
    setMatched(null);
    setReqId("");
    setParseError("");
    setGenerateError("");
    setGenerateSuccess("");
  };

  const handleReqIdChange = (value) => {
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
    console.log(results)
    setMatched(results);
  };

  const handlePortCountChange = (value) => {
    const n = Number(value);
    setNumPorts(n);
    setPorts((prev) => {
      const updated = [...prev];
      if (n > updated.length) {
        while (updated.length < n) updated.push({ key: "", value: "" });
      } else {
        updated.splice(n);
      }
      return updated;
    });
  };

  const handlePortChange = (index, field, value) => {
    const updated = [...ports];
    updated[index][field] = value;
    setPorts(updated);
  };

  const handleGenerate = async () => {
    setGenerateError("");
    setGenerateSuccess("");

    if (!modelName.trim()) {
      setGenerateError("Enter a model name first.");
      return;
    }
    if (!reqId.trim() || !matched || matched.length === 0) {
      setGenerateError("Look up a requirement ID with matching testcases first.");
      return;
    }

    // Build a requirement description from the matched testcase rows
    const requirementDescription = matched
      .map(
        (tc) =>
          `${tc.testCaseId} - ${tc.title}: ${tc.objective} (Pass/Fail: ${tc.passFailCriteria})`
      )
      .join("\n");

    const portNames = ports.map((p) => p.key.trim()).filter(Boolean);

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
      a.download = `MBD_TestSuite_${reqId.trim()}.m`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setGenerateSuccess("Test suite generated and downloaded successfully.");
    } catch (err) {
      console.error(err);
      setGenerateError(err.message || "Something went wrong generating the test suite.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent">
      <Navbar />

      <main className="mx-auto max-w-4xl px-6 py-8 sm:px-8 lg:px-10">
        <div className="space-y-6 rounded-[28px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:p-8">
      {/* Model Name */}
      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700">Model Name</label>
        <input
          type="text"
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-800 shadow-sm transition focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {/* Excel Upload */}
      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700">Testcase Workbook</label>

        {!fileName ? (
          <label className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition hover:border-blue-500 hover:bg-blue-50/40">
            <Upload className="h-6 w-6 text-slate-400" />
            <span className="text-sm text-slate-600">
              <span className="font-semibold text-blue-700">Click to upload</span> an .xlsx testcase file
            </span>
            <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
          </label>
        ) : (
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 shrink-0 text-blue-700" />
              <span className="truncate text-sm text-slate-800">{fileName}</span>
              <span className="shrink-0 text-xs text-slate-500">
                ({allTestCases.length} testcase{allTestCases.length === 1 ? "" : "s"} found)
              </span>
            </div>
            <button
              type="button"
              onClick={clearFile}
              className="ml-2 shrink-0 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {parseError && <p className="mt-2 text-sm text-red-600">{parseError}</p>}
      </div>

      {/* Requirement ID lookup */}
      {fileName && !parseError && (
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Requirement ID</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={reqId}
              onChange={(e) => handleReqIdChange(e.target.value)}
              placeholder="e.g. REQ-IB_BHMS-SC-PSB-002"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-4 py-2.5 text-slate-800 shadow-sm transition focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
      )}

      {/* Preview table */}
      {matched !== null && (
        <div>
          {matched.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              No testcases found for "{reqId}". Check the requirement ID and try again.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Test Case ID</th>
                    <th className="text-left px-3 py-2 font-medium">Title</th>
                    <th className="text-left px-3 py-2 font-medium min-w-[220px]">Objective</th>
                    <th className="text-left px-3 py-2 font-medium min-w-[180px]">Pass/Fail Criteria</th>
                    <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Priority</th>
                    <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {matched.map((tc) => (
                    <tr key={tc.testCaseId}>
                      <td className="px-3 py-2 font-mono text-xs text-gray-800 whitespace-nowrap align-top">
                        {tc.testCaseId}
                      </td>
                      <td className="px-3 py-2 text-gray-800 align-top">{tc.title}</td>
                      <td className="px-3 py-2 text-gray-600 align-top whitespace-pre-wrap">{tc.objective}</td>
                      <td className="px-3 py-2 text-gray-600 align-top whitespace-pre-wrap">{tc.passFailCriteria}</td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        <span
                          className={
                            "inline-block rounded-full px-2 py-0.5 text-xs font-medium " +
                            (tc.priority === "High"
                              ? "bg-red-100 text-red-700"
                              : tc.priority === "Medium"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-gray-100 text-gray-700")
                          }
                        >
                          {tc.priority || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        <span
                          className={
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium " +
                            (tc.status === "Pass"
                              ? "bg-green-100 text-green-700"
                              : tc.status === "Fail"
                              ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-600")
                          }
                        >
                          {tc.status === "Pass" && <CheckCircle2 className="w-3 h-3" />}
                          {tc.status || "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Number of Ports */}
      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700">Number of Ports</label>
        <input
          type="number"
          min={0}
          value={numPorts}
          onChange={(e) => handlePortCountChange(e.target.value)}
          className="w-40 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-800 shadow-sm transition focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {/* Dynamic Ports */}
      {ports.map((port, index) => (
        <div key={index}>
          <label className="mb-2 block text-sm font-semibold text-slate-700">
            Input Port Name {index + 1}
          </label>
          <input
            type="text"
            value={port.key}
            onChange={(e) => handlePortChange(index, "key", e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-800 shadow-sm transition focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
      ))}

      <div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="rounded-xl bg-blue-700 px-6 py-2.5 text-white shadow-sm transition hover:bg-blue-800 disabled:opacity-50"
        >
          {isGenerating ? "Generating…" : "Generate Testcase"}
        </button>

        {generateError && <p className="mt-2 text-sm text-red-600">{generateError}</p>}
        {generateSuccess && <p className="mt-2 text-sm text-green-600">{generateSuccess}</p>}
      </div>
        </div>
      </main>
    </div>
  );
}