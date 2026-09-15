// Realistic test: simulate what the app does — generate a MATLAB block for one test case
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = "gemini-3.6-flash";

const prompt = `Write ONE executable MATLAB code block for a Simulink verification test.
Output ONLY MATLAB code. No markdown fences, no explanation, no function definitions, no other test cases.

Fixed values (copy exactly, never rename or invent alternatives):
  Model variable: mdl        (already holds the model name)
  Sample time variable: ts   (already defined, in seconds)
  Test Case ID string: 'TC-ESC-001'
  Root inport names, in this order: 'BrakePressure', 'YawRate'

From the requirement document:
  Title: Yaw Rate Stability Check
  Objective: Verify the ESC controller maintains yaw rate within bounds during a step brake pressure input
  Pass/Fail Criteria: Yaw rate must settle within 0.5 rad/s of target within 2s after brake pressure step

Exact figures found in the Pass/Fail Criteria (use these verbatim — do not round, substitute, or invent additional thresholds): 0.5, 2

The block must:
1. Build tVec = (0:ts:DURATION)'. If an anchor above is a frequency in Hz, DURATION must give at
   least 8-10 full cycles of that frequency (DURATION = 10/f, min 1s). Otherwise pick 1-5s.
2. Build one input signal per port listed above, in that order, that plausibly exercises the
   Objective. Numeric/pressure-like ports: sine at the anchor frequency if one exists, else a step
   or ramp. Boolean/flag ports: ones()/zeros(), toggled mid-run only if the Objective names a
   transition (e.g. "reset on invalidation", "power-up").
3. Call exactly: [t, y] = runModelSimulation(mdl, tVec, {sig1, sig2, ...}, {'BrakePressure', 'YawRate'});
4. Compute ONE real numeric metric from y. Choose exactly one of these patterns based on the
   Objective/Criteria wording, and say which one you picked in a one-line comment above the
   calculation:
     - "gain/attenuation at Hz"      -> FFT magnitude ratio out/in at the anchor frequency
     - "settles within X after Ys"   -> time index where |y - final(y)| stays below X, minus offset
     - "steady-state error <= X"     -> mean(abs(y(end-N:end) - target)) over the tail window
     - "changes by X% after toggle"  -> compare mean(y) in pre-toggle vs post-toggle windows
     - "stays within bounds [lo,hi]" -> max/min(y) against the bounds
     - "finite/no fault"             -> ~any(isnan(y)) && ~any(isinf(y))
   Never hardcode measured to 0.
5. Set expected and tolerance directly from the anchor figures above (not re-derived or rounded).
6. Decide isPass by comparing measured to expected within tolerance.
7. Append exactly one row:
   results = [results; {"TC-ESC-001", "<short metric name>", measured, expected, tolerance, ternary(isPass,"PASS","FAIL"), "<short note>"}];
8. End with (reuse the same signal/port cell arrays from step 3):
   saveData(t, {sig1, sig2, ...}, {'BrakePressure', 'YawRate'}, y, 'TC-ESC-001', dataDir);
   plotTestCase(t, {sig1, sig2, ...}, {'BrakePressure', 'YawRate'}, y, 'TC-ESC-001', 'Yaw Rate Stability Check', plotsDir);
9. Start with: fprintf('Running TC-ESC-001...\\n');
10. Only use "PENDING" instead of a real PASS/FAIL if the Objective explicitly says this test case
    is a placeholder, manual, or future item.`;

async function main() {
  console.log(`Testing ${MODEL} with a realistic MATLAB block generation prompt...\n`);

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { temperature: 0.15, maxOutputTokens: 4000 },
    });

    const text = response.text ?? "";
    console.log("✅ SUCCESS");
    console.log("Response length:", text.length, "chars");
    console.log("Finish reason:", response.candidates?.[0]?.finishReason ?? "n/a");
    console.log("\n--- Generated MATLAB block ---\n");
    console.log(text);
    console.log("\n--- End ---");

    // Quick validation checks like the app does
    const checks = [
      ["test case ID", text.includes("TC-ESC-001")],
      ["results row", /results\s*=\s*\[results;/.test(text)],
      ["runModelSimulation call", text.includes("runModelSimulation(")],
      ["saveData call", text.includes("saveData(")],
      ["plotTestCase call", text.includes("plotTestCase(")],
      ["port 'BrakePressure'", text.includes("BrakePressure")],
      ["port 'YawRate'", text.includes("YawRate")],
    ];
    console.log("\n--- Validation ---");
    for (const [name, ok] of checks) {
      console.log(`${ok ? "✅" : "❌"} ${name}`);
    }
  } catch (err) {
    console.log("❌ FAILED");
    console.log("Error:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();