import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const payload = await req.json();

    // Read the reference script
    const referenceScriptPath = path.join(process.cwd(), "lib", "referenceScript.txt");
    const referenceScript = fs.readFileSync(referenceScriptPath, "utf-8");

    const systemPrompt = `You are a senior MATLAB/Simulink verification engineer.
The Test Case Flow has already been reviewed and approved.
DO NOT reinterpret the requirement.
Your responsibility is to convert the supplied Test Case Flow into executable MATLAB test code.

Use:
1. Verified Test Case Flow
2. Input/Output Definition
3. The provided reference test architecture (MultiTestCaseRun_ArbD.m)

Follow the established testing pattern.
Generate real executable MATLAB code.
Do not invent model interfaces.
Preserve requirement and test-case traceability.

Return ONLY the MATLAB code. Do not wrap it in markdown blocks like \`\`\`matlab. Just return the raw code.

Reference Architecture:
${referenceScript}
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: JSON.stringify(payload),
      config: {
        systemInstruction: systemPrompt,
      },
    });

    let text =
      typeof response.text === "function" ? response.text() : response.text || "";
    if (!text) {
      throw new Error("Empty response from LLM");
    }

    // Clean up markdown blocks if the LLM still includes them
    if (text.startsWith("\`\`\`matlab")) {
      text = text.replace(/^\`\`\`matlab\n/, "").replace(/\n\`\`\`$/, "");
    } else if (text.startsWith("\`\`\`")) {
      text = text.replace(/^\`\`\`\n/, "").replace(/\n\`\`\`$/, "");
    }

    return NextResponse.json({ script: text });
  } catch (error: any) {
    console.error("Error generating MATLAB script:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate MATLAB script" },
      { status: 500 }
    );
  }
}
