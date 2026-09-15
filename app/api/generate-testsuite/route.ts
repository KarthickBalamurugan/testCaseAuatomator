import { NextRequest, NextResponse } from "next/server";
import { generateMatlabTestSuite } from "@/lib/generateMatlabTestSuite";

/**
 * POST /api/generate-testsuite
 *
 * Accepts structured test requirements + I/O ports and generates a MATLAB
 * Simulink test suite via the LLM. Returns the .m script as plain text.
 *
 * Body:
 *  - modelName:         string (required) — Simulink model name
 *  - requirementId:     string (optional) — single requirement to generate for
 *  - requirementIds:    string[] (optional) — multiple requirements (multi-req mode)
 *  - testCases:         TestCaseInput[] (required) — structured test case rows
 *  - ports:             string[] (required) — Simulink root inport names
 *  - portSpecs:         PortSpec[] (optional) — Input/Output metadata
 *  - count:             number (optional) — sanity check
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      modelName,
      requirementId,
      requirementIds,
      requirementDescription,
      testCases,
      ports,
      portSpecs,
      count,
    } = body ?? {};

    // ── Validate modelName ──
    if (typeof modelName !== "string" || !modelName.trim()) {
      return NextResponse.json(
        { error: "modelName is required and must be a non-empty string." },
        { status: 400 }
      );
    }

    // ── Validate requirement IDs ──
    const hasSingleReq =
      typeof requirementId === "string" && requirementId.trim().length > 0;
    const hasMultiReqs =
      Array.isArray(requirementIds) &&
      requirementIds.length > 0 &&
      requirementIds.every(
        (r: unknown) => typeof r === "string" && (r as string).trim().length > 0
      );

    if (!hasSingleReq && !hasMultiReqs) {
      return NextResponse.json(
        {
          error:
            "Either 'requirementId' (string) or 'requirementIds' (string array) is required.",
        },
        { status: 400 }
      );
    }

    // ── Validate test cases ──
    const hasTestCases = Array.isArray(testCases) && testCases.length > 0;
    const hasDescription =
      typeof requirementDescription === "string" &&
      requirementDescription.trim().length > 0;

    if (!hasTestCases && !hasDescription) {
      return NextResponse.json(
        {
          error:
            "Either 'testCases' (structured array) or 'requirementDescription' (text) must be provided.",
        },
        { status: 400 }
      );
    }

    // ── Sanitize ports ──
    const safePorts: string[] = Array.isArray(ports)
      ? ports.filter(
          (p): p is string => typeof p === "string" && p.trim().length > 0
        )
      : [];

    if (safePorts.length === 0) {
      return NextResponse.json(
        { error: "At least one Input port must be provided in 'ports'." },
        { status: 400 }
      );
    }

    // ── Sanitize port specs ──
    const safePortSpecs = Array.isArray(portSpecs)
      ? portSpecs
          .filter(
            (p: unknown): p is { name: string; ioRole: string; datatype?: string } =>
              !!p &&
              typeof p === "object" &&
              typeof (p as { name?: unknown }).name === "string" &&
              ((p as { ioRole?: unknown }).ioRole === "Input" ||
                (p as { ioRole?: unknown }).ioRole === "Output")
          )
          .map((p) => ({
            name: p.name.trim(),
            ioRole: p.ioRole as "Input" | "Output",
            datatype:
              typeof p.datatype === "string" ? p.datatype.trim() : "",
          }))
          .filter((p) => p.name.length > 0)
      : [];

    const safeCount =
      typeof count === "number" && Number.isFinite(count) && count > 0
        ? Math.floor(count)
        : testCases?.length ?? 5;

    // ── Call the generator ──
    const matlabCode = await generateMatlabTestSuite({
      modelName: modelName.trim(),
      ...(hasSingleReq ? { requirementId: requirementId.trim() } : {}),
      ...(hasMultiReqs
        ? { requirementIds: requirementIds.map((r: string) => r.trim()) }
        : {}),
      ...(hasTestCases
        ? { testCases }
        : { requirementDescription: requirementDescription.trim() }),
      ports: safePorts,
      portSpecs: safePortSpecs,
      count: safeCount,
    });

    if (!matlabCode) {
      return NextResponse.json(
        { error: "The model returned an empty response. Please try again." },
        { status: 502 }
      );
    }

    const safeFileId = hasMultiReqs
      ? "ALL"
      : (requirementId as string).trim().replace(/[^a-zA-Z0-9._-]/g, "_");

    return new NextResponse(matlabCode, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="MBD_TestSuite_${safeFileId}.m"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("generate-testsuite error:", err);
    return NextResponse.json(
      { error: "Failed to generate test suite. Please try again." },
      { status: 500 }
    );
  }
}
