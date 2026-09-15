// Quick API key test for Gemini
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function main() {
  const model = process.argv[2] ?? "gemini-3.1-pro-preview";
  console.log(`Testing ${model} with the configured API key...\n`);

  try {
    const response = await ai.models.generateContent({
      model,
      contents: "Reply with exactly: API_KEY_WORKS",
      config: { maxOutputTokens: 50 },
    });

    console.log("✅ SUCCESS");
    console.log("Model response:", JSON.stringify(response.text ?? "(empty)"));
    console.log("Usage metadata:", JSON.stringify(response.usageMetadata ?? "n/a"));
    console.log("Full candidates:", JSON.stringify(response.candidates ?? "n/a", null, 2));
  } catch (err) {
    console.log("❌ FAILED");
    console.log("Error:", err instanceof Error ? err.message : String(err));
    if (err && typeof err === "object" && "status" in err) {
      console.log("Status:", err.status);
    }
    process.exitCode = 1;
  }
}

main();