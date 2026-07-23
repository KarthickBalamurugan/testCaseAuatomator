import { NextRequest, NextResponse } from "next/server";
import { generateMatlabTestSuite } from "@/lib/generateMatlabTestSuite";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { modelName, requirementId, requirementDescription, ports, count } = body ?? {};

    if (
      typeof modelName !== "string" ||
      !modelName.trim() ||
      typeof requirementId !== "string" ||
      !requirementId.trim() ||
      typeof requirementDescription !== "string" ||
      !requirementDescription.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "modelName, requirementId, and requirementDescription are required and must be non-empty strings.",
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
      requirementId: requirementId.trim(),
      requirementDescription: requirementDescription.trim(),
      ports: safePorts,
      count: safeCount,
    });

    if (!matlabCode) {
      return NextResponse.json(
        { error: "The model returned an empty response. Please try again." },
        { status: 502 }
      );
    }

    // Sanitize requirementId for use in a filename
    const safeFileId = requirementId.trim().replace(/[^a-zA-Z0-9._-]/g, "_");

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