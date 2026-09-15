import { NextRequest, NextResponse } from "next/server";
import { generateMatlabTestSuite } from "@/lib/generateMatlabTestSuite";

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
      count,
    } = body ?? {};

    if (typeof modelName !== "string" || !modelName.trim()) {
      return NextResponse.json(
        { error: "modelName is required and must be a non-empty string." },
        { status: 400 }
      );
    }

    // Validate requirement ID(s)
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

    // Either structured testCases or a text requirementDescription is needed
    const hasTestCases = Array.isArray(testCases) && testCases.length > 0;
    const hasDescription =
      typeof requirementDescription === "string" && requirementDescription.trim().length > 0;

    if (!hasTestCases && !hasDescription) {
      return NextResponse.json(
        {
          error:
            "Either 'testCases' (structured array) or 'requirementDescription' (text) must be provided.",
        },
        { status: 400 }
      );
    }

    const safePorts: string[] = Array.isArray(ports)
      ? ports.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      : [];

    const safeCount =
      typeof count === "number" && Number.isFinite(count) && count > 0
        ? Math.floor(count)
        : 5;

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
      count: safeCount,
    });

    if (!matlabCode) {
      return NextResponse.json(
        { error: "The model returned an empty response. Please try again." },
        { status: 502 }
      );
    }

    // Determine filename: "ALL" for multi-requirement, or sanitized single ID
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