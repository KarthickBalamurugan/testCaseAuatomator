"use client";

import React, { useState, useMemo } from "react";
import {
  ModelInterface,
  InterfaceGroup,
  InterfaceBus,
  InterfacePort,
  InterfaceBusElement,
  InterfaceSignal,
  generateId,
  createEmptyPort,
  createEmptyBus,
  createEmptyBusElement,
  formatDimensions,
  validateInterface,
  cleanInterfaceForExport,
} from "@/lib/interfaceExcelParser";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Edit2,
  GripVertical,
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  FileJson,
  Settings2,
} from "lucide-react";

interface InterfaceEditorProps {
  interfaceState: ModelInterface;
  onChange: (newState: ModelInterface) => void;
  onConfirm: () => void;
  isConfirmed: boolean;
}

export default function InterfaceEditor({
  interfaceState,
  onChange,
  onConfirm,
  isConfirmed,
}: InterfaceEditorProps) {
  const [showJsonPreview, setShowJsonPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  const validation = useMemo(() => validateInterface(interfaceState), [interfaceState]);
  const cleanJson = useMemo(() => cleanInterfaceForExport(interfaceState), [interfaceState]);
  const jsonString = useMemo(() => JSON.stringify(cleanJson, null, 2), [cleanJson]);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const updateGroup = (groupName: "inputs" | "outputs", newGroup: InterfaceGroup) => {
    onChange({
      ...interfaceState,
      [groupName]: newGroup,
    });
  };

  return (
    <div className="space-y-6">
      {/* Validation Banner */}
      {(!validation.isValid || validation.warnings.length > 0) && (
        <div className={`rounded-lg border p-3 text-sm ${validation.hasErrors ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>
          <div className="flex items-center gap-2 font-semibold mb-2">
            <AlertCircle className="h-4 w-4" />
            {validation.hasErrors ? "Interface has errors" : "Interface has warnings"}
          </div>
          <ul className="list-disc pl-5 space-y-1 text-xs opacity-90">
            {validation.errors.map((e, i) => (
              <li key={`err-${i}`}>
                <span className="font-mono opacity-75">{e.path}:</span> {e.message}
              </li>
            ))}
            {validation.warnings.map((w, i) => (
              <li key={`warn-${i}`}>
                <span className="font-mono opacity-75">{w.path}:</span> {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Inputs Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Input Ports & Buses</h3>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const newGroup = { ...interfaceState.inputs };
                newGroup.ports = [...newGroup.ports, createEmptyPort("NewInputPort")];
                updateGroup("inputs", newGroup);
              }}
              className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition"
            >
              <Plus className="h-3.5 w-3.5" /> Port
            </button>
            <button
              onClick={() => {
                const newGroup = { ...interfaceState.inputs };
                newGroup.buses = [...newGroup.buses, createEmptyBus("NewInputBus")];
                updateGroup("inputs", newGroup);
              }}
              className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition"
            >
              <Plus className="h-3.5 w-3.5" /> Bus
            </button>
          </div>
        </div>
        
        <GroupEditor 
          group={interfaceState.inputs} 
          onChange={(g) => updateGroup("inputs", g)} 
        />
      </div>

      {/* Outputs Section */}
      <div className="space-y-4 mt-8">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Output Ports & Buses</h3>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const newGroup = { ...interfaceState.outputs };
                newGroup.ports = [...newGroup.ports, createEmptyPort("NewOutputPort")];
                updateGroup("outputs", newGroup);
              }}
              className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition"
            >
              <Plus className="h-3.5 w-3.5" /> Port
            </button>
            <button
              onClick={() => {
                const newGroup = { ...interfaceState.outputs };
                newGroup.buses = [...newGroup.buses, createEmptyBus("NewOutputBus")];
                updateGroup("outputs", newGroup);
              }}
              className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition"
            >
              <Plus className="h-3.5 w-3.5" /> Bus
            </button>
          </div>
        </div>
        
        <GroupEditor 
          group={interfaceState.outputs} 
          onChange={(g) => updateGroup("outputs", g)} 
        />
      </div>

      {/* Confirm Button */}
      <div className="pt-6 border-t border-slate-800 flex items-center justify-between">
        <div className="text-xs text-slate-400">
          {isConfirmed ? (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Interface Confirmed
            </span>
          ) : (
            "Review and confirm the interface to proceed."
          )}
        </div>
        <button
          onClick={onConfirm}
          disabled={validation.hasErrors}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <CheckCircle2 className="h-4 w-4" />
          {isConfirmed ? "Update Confirmed Interface" : "Confirm Interface"}
        </button>
      </div>

      {/* JSON Preview */}
      <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
        <button
          onClick={() => setShowJsonPreview(!showJsonPreview)}
          className="flex w-full items-center justify-between bg-slate-800/50 px-4 py-3 hover:bg-slate-800 transition"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <FileJson className="h-4 w-4 text-blue-400" />
            Live JSON Preview
          </div>
          {showJsonPreview ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
        </button>
        
        {showJsonPreview && (
          <div className="p-4 border-t border-slate-800 relative">
            <button
              onClick={handleCopyJson}
              className="absolute top-4 right-4 inline-flex items-center gap-1.5 rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <pre className="text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
              {jsonString}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Group Editor (Ports & Buses) ────────────────────────────── */

function GroupEditor({ group, onChange }: { group: InterfaceGroup; onChange: (g: InterfaceGroup) => void }) {
  if (group.buses.length === 0 && group.ports.length === 0) {
    return <div className="text-xs text-slate-500 italic py-4 text-center border border-dashed border-slate-800 rounded-lg">No items defined.</div>;
  }

  return (
    <div className="space-y-3">
      {group.buses.map((bus, idx) => (
        <BusEditor
          key={bus.id}
          bus={bus}
          onChange={(newBus) => {
            const newBuses = [...group.buses];
            newBuses[idx] = newBus;
            onChange({ ...group, buses: newBuses });
          }}
          onRemove={() => {
            const newBuses = [...group.buses];
            newBuses.splice(idx, 1);
            onChange({ ...group, buses: newBuses });
          }}
        />
      ))}
      {group.ports.map((port, idx) => (
        <SignalEditor
          key={port.id}
          signal={port}
          onChange={(newPort) => {
            const newPorts = [...group.ports];
            newPorts[idx] = newPort;
            onChange({ ...group, ports: newPorts });
          }}
          onRemove={() => {
            const newPorts = [...group.ports];
            newPorts.splice(idx, 1);
            onChange({ ...group, ports: newPorts });
          }}
          isTopLevelPort={true}
        />
      ))}
    </div>
  );
}

/* ─── Bus Editor ──────────────────────────────────────────────── */

function BusEditor({ bus, onChange, onRemove }: { bus: InterfaceBus; onChange: (b: InterfaceBus) => void; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/30 overflow-hidden">
      <div className="flex items-center justify-between bg-slate-800/80 px-3 py-2">
        <div className="flex items-center gap-2 flex-1">
          <button onClick={() => setExpanded(!expanded)} className="text-slate-400 hover:text-white">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          
          {isEditing ? (
            <input
              type="text"
              value={bus.name}
              onChange={(e) => onChange({ ...bus, name: e.target.value })}
              onBlur={() => setIsEditing(false)}
              onKeyDown={(e) => e.key === "Enter" && setIsEditing(false)}
              autoFocus
              className="bg-slate-900 border border-blue-500 rounded px-2 py-0.5 text-sm text-white font-mono w-48 focus:outline-none"
            />
          ) : (
            <span 
              className="font-mono text-sm font-bold text-blue-400 cursor-pointer hover:underline"
              onClick={() => setIsEditing(true)}
            >
              {bus.name || "UnnamedBus"}
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wider text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded">Bus</span>
        </div>
        
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const newElements = [...(bus.elements || [])];
              newElements.push(createEmptyBusElement("NewElement"));
              onChange({ ...bus, elements: newElements, is_bus: true } as any);
              setExpanded(true);
            }}
            className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-700 rounded transition"
            title="Add Element"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onRemove}
            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition"
            title="Remove Bus"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-3 pl-8 border-t border-slate-700/50 space-y-2 bg-slate-900/20">
          {(!bus.elements || bus.elements.length === 0) ? (
            <div className="text-xs text-slate-500 italic">No elements in this bus.</div>
          ) : (
            bus.elements.map((elem, idx) => (
              <BusElementEditor
                key={elem.id}
                element={elem}
                onChange={(newElem) => {
                  const newElements = [...bus.elements];
                  newElements[idx] = newElem;
                  onChange({ ...bus, elements: newElements });
                }}
                onRemove={() => {
                  const newElements = [...bus.elements];
                  newElements.splice(idx, 1);
                  onChange({ ...bus, elements: newElements });
                }}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Bus Element Editor (Recursive) ──────────────────────────── */

function BusElementEditor({ element, onChange, onRemove }: { element: InterfaceBusElement; onChange: (e: InterfaceBusElement) => void; onRemove: () => void }) {
  if (element.is_bus) {
    return (
      <BusEditor 
        bus={element as InterfaceBus} 
        onChange={(b) => onChange({ ...b, is_bus: true } as InterfaceBusElement)} 
        onRemove={onRemove} 
      />
    );
  }
  return <SignalEditor signal={element} onChange={onChange} onRemove={onRemove} />;
}

/* ─── Signal Editor ───────────────────────────────────────────── */

function SignalEditor({ signal, onChange, onRemove, isTopLevelPort = false }: { signal: InterfaceSignal; onChange: (s: InterfaceSignal) => void; onRemove: () => void; isTopLevelPort?: boolean }) {
  const [isEditing, setIsEditing] = useState(false);

  const updateField = (field: keyof InterfaceSignal, value: any) => {
    onChange({ ...signal, [field]: value });
  };

  const updateMetadata = (key: string, value: any) => {
    const newMeta = { ...(signal.metadata || {}) };
    if (value === "" || value === undefined) {
      delete newMeta[key];
    } else {
      newMeta[key] = value;
    }
    onChange({ ...signal, metadata: Object.keys(newMeta).length > 0 ? newMeta : undefined });
  };

  if (isEditing) {
    return (
      <div className="rounded-lg border border-blue-500/50 bg-slate-800 p-3 shadow-lg">
        <div className="flex justify-between items-center mb-3 border-b border-slate-700 pb-2">
          <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Edit {isTopLevelPort ? "Port" : "Element"}</h4>
          <button onClick={() => setIsEditing(false)} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded">Done</button>
        </div>
        
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[10px] uppercase text-slate-400 mb-1">Name</label>
            <input
              type="text"
              value={signal.name}
              onChange={(e) => updateField("name", e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white font-mono focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase text-slate-400 mb-1">Dimensions</label>
            <input
              type="text"
              value={typeof signal.dimensions === "string" ? signal.dimensions : (Array.isArray(signal.dimensions) ? signal.dimensions.join(" x ") : "")}
              onChange={(e) => updateField("dimensions", e.target.value)}
              placeholder="e.g. 1 x 4"
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white font-mono focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase text-slate-400 mb-1">Data Type</label>
            <input
              type="text"
              value={signal.data_type || ""}
              onChange={(e) => updateField("data_type", e.target.value)}
              placeholder="e.g. double, boolean"
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white font-mono focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase text-slate-400 mb-1">Signal Type</label>
            <select
              value={signal.signal_type || ""}
              onChange={(e) => updateField("signal_type", e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="">-- Select --</option>
              <option value="real">real</option>
              <option value="complex">complex</option>
              <option value="enum">enum</option>
              <option value="boolean">boolean</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] uppercase text-slate-400 mb-1">Wheel Order (comma separated)</label>
            <input
              type="text"
              value={(signal.wheel_order || []).join(", ")}
              onChange={(e) => updateField("wheel_order", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
              placeholder="e.g. FL, FR, RL, RR"
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white font-mono focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="border-t border-slate-700 pt-3">
          <h5 className="text-[10px] uppercase text-slate-400 mb-2">Metadata</h5>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Unit</label>
              <input
                type="text"
                value={(signal.metadata?.unit as string) || ""}
                onChange={(e) => updateMetadata("unit", e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Description</label>
              <input
                type="text"
                value={(signal.metadata?.description as string) || ""}
                onChange={(e) => updateMetadata("description", e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Min</label>
              <input
                type="text"
                value={(signal.metadata?.min as string) || ""}
                onChange={(e) => updateMetadata("min", e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1">Max</label>
              <input
                type="text"
                value={(signal.metadata?.max as string) || ""}
                onChange={(e) => updateMetadata("max", e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start justify-between rounded-md border border-slate-700/50 bg-slate-800/40 px-3 py-2 hover:border-slate-600 hover:bg-slate-800/60 transition">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-sm font-semibold text-slate-200 truncate">
            {signal.name || <span className="text-red-400 italic">Unnamed</span>}
          </span>
          {isTopLevelPort && <span className="text-[9px] uppercase tracking-wider text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded">Port</span>}
        </div>
        
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Dim:</span>
            <span className="font-mono text-slate-300">{formatDimensions(signal.dimensions)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Type:</span>
            <span className={`font-mono ${!signal.data_type ? "text-amber-400" : "text-emerald-400"}`}>
              {signal.data_type || "missing"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500">Sig:</span>
            <span className={`font-mono ${!signal.signal_type ? "text-amber-400" : "text-purple-400"}`}>
              {signal.signal_type || "missing"}
            </span>
          </div>
          {signal.wheel_order && signal.wheel_order.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Wheels:</span>
              <span className="font-mono text-blue-300">{signal.wheel_order.join(" | ")}</span>
            </div>
          )}
        </div>
        
        {signal.metadata && Object.keys(signal.metadata).length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {Object.entries(signal.metadata).map(([k, v]) => (
              <span key={k} className="inline-flex items-center rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-400 border border-slate-800">
                <span className="opacity-75 mr-1">{k}:</span>
                <span className="text-slate-300 truncate max-w-[150px]">{String(v)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      
      <div className="flex items-center gap-1 ml-4 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => setIsEditing(true)}
          className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded transition"
          title="Edit"
        >
          <Edit2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onRemove}
          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded transition"
          title="Remove"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
