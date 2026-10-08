import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const payload = await req.json();

    const systemPrompt = `You are a senior automotive verification engineer.
Analyse the supplied Test Requirement, Input/Output Definition, and Configuration Constants.
Your responsibility is to derive the complete Test Case Flow for each test case.
Do NOT generate MATLAB code.

Determine for each test case:
- objective
- preconditions
- inputs (map abstract requirements to actual signals using the I/O definition)
- stimulus
- sequence
- expected behaviour
- expected outputs
- pass/fail criteria
- traceability

Return a JSON array of Test Case Flow objects.
Each object MUST follow this schema:
[
  {
    "testCaseId": "string",
    "requirementId": "string",
    "objective": "string",
    "preconditions": ["string"],
    "inputs": [
      {
        "name": "string",
        "bus": "string",
        "port": "string",
        "datatype": "string",
        "dimension": "string",
        "value": "string",
        "purpose": "string"
      }
    ],
    "testFlow": [
      {
        "step": 1,
        "action": "string",
        "expectedBehavior": "string"
      }
    ],
    "expectedOutputs": [
      {
        "name": "string",
        "expectedValue": "string",
        "validation": "string",
        "reason": "string"
      }
    ],
    "passFailCriteria": ["string"],
    "traceability": {
      "requirementId": "string",
      "testCaseId": "string"
    }
  }
]`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: JSON.stringify(payload),
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      },
    });

    const text =
      typeof response.text === "function" ? response.text() : response.text;
    if (!text) {
      throw new Error("Empty response from LLM");
    }

    return NextResponse.json({ flow: JSON.parse(text) });
  } catch (error: any) {
    console.error("Error generating flow:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate flow" },
      { status: 500 }
    );
  }
}
