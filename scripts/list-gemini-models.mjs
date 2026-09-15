// List available Gemini models
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function main() {
  try {
    const result = await ai.models.list();
    const models = result.models ?? [];
    console.log(`Found ${models.length} models:\n`);
    for (const m of models) {
      const methods = m.supportedGenerationMethods?.join(", ") ?? "";
      if (methods.includes("generateContent")) {
        console.log(`- ${m.name}  [${methods}]`);
      }
    }
  } catch (err) {
    console.log("❌ FAILED");
    console.log("Error:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();