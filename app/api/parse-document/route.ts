import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";

export const maxDuration = 60; // 60 seconds timeout for larger OCR / PDFs

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "No file uploaded. Please provide a valid file." },
        { status: 400 }
      );
    }

    const fileName = file.name || "uploaded_file";
    const fileType = (file.type || "").toLowerCase();
    const extension = fileName.includes(".")
      ? fileName.substring(fileName.lastIndexOf(".")).toLowerCase()
      : "";

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return NextResponse.json(
        { error: "The uploaded file is empty." },
        { status: 400 }
      );
    }

    // 1. Check if PDF
    const isPdf =
      fileType === "application/pdf" ||
      fileType.includes("pdf") ||
      extension === ".pdf";

    if (isPdf) {
      let parser: PDFParse | null = null;
      try {
        parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        const extractedText = (result.text || "").trim();
        const totalPages = result.total || result.pages?.length || 1;

        const pagesData = (result.pages || []).map((p, idx) => ({
          pageNum: p.num || idx + 1,
          text: (p.text || "").trim(),
        }));

        const wordCount = extractedText
          ? extractedText.split(/\s+/).filter(Boolean).length
          : 0;
        const lineCount = extractedText
          ? extractedText.split(/\r?\n/).filter((l) => l.trim().length > 0).length
          : 0;

        return NextResponse.json({
          success: true,
          fileName,
          fileType: "pdf",
          method: "PDF Text Extraction",
          text: extractedText,
          pages: pagesData,
          stats: {
            characters: extractedText.length,
            words: wordCount,
            lines: lineCount,
            pages: totalPages,
          },
          message:
            extractedText.length === 0
              ? "The PDF did not contain selectable text (it may be a scanned image PDF)."
              : undefined,
        });
      } catch (pdfErr) {
        console.error("PDF parsing error:", pdfErr);
        return NextResponse.json(
          {
            error: `Failed to extract text from PDF: ${
              pdfErr instanceof Error ? pdfErr.message : "Unknown PDF error"
            }`,
          },
          { status: 422 }
        );
      } finally {
        if (parser) {
          try {
            await parser.destroy();
          } catch {
            // ignore cleanup error
          }
        }
      }
    }

    // 2. Check if Image (Run Tesseract OCR)
    const isImage =
      fileType.startsWith("image/") ||
      [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif"].includes(
        extension
      );

    if (isImage) {
      let worker: any = null;
      try {
        worker = await createWorker("eng");
        const { data } = await worker.recognize(buffer);
        const extractedText = (data.text || "").trim();

        const wordCount = extractedText
          ? extractedText.split(/\s+/).filter(Boolean).length
          : 0;
        const lineCount = extractedText
          ? extractedText.split(/\r?\n/).filter((l) => l.trim().length > 0).length
          : 0;

        return NextResponse.json({
          success: true,
          fileName,
          fileType: "image",
          method: "Tesseract OCR",
          text: extractedText,
          stats: {
            characters: extractedText.length,
            words: wordCount,
            lines: lineCount,
            confidence: Math.round(data.confidence || 0),
          },
        });
      } catch (ocrErr) {
        console.error("Tesseract OCR error:", ocrErr);
        return NextResponse.json(
          {
            error: `Failed to run OCR on image: ${
              ocrErr instanceof Error ? ocrErr.message : "Unknown OCR error"
            }`,
          },
          { status: 422 }
        );
      } finally {
        if (worker) {
          try {
            await worker.terminate();
          } catch {
            // ignore termination error
          }
        }
      }
    }

    // 3. Plaintext or structured text formats (.txt, .csv, .json, .md, .tsv, .log, etc.)
    const isText =
      fileType.startsWith("text/") ||
      [".txt", ".csv", ".json", ".md", ".tsv", ".log", ".xml", ".yaml", ".yml"].includes(
        extension
      );

    if (isText) {
      try {
        const text = buffer.toString("utf-8");
        const trimmed = text.trim();
        const wordCount = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
        const lineCount = trimmed
          ? trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0).length
          : 0;

        return NextResponse.json({
          success: true,
          fileName,
          fileType: "text",
          method: "Text Parser",
          text: trimmed,
          stats: {
            characters: trimmed.length,
            words: wordCount,
            lines: lineCount,
          },
        });
      } catch (txtErr) {
        return NextResponse.json(
          { error: "Failed to read text file." },
          { status: 422 }
        );
      }
    }

    // Default fallback: Try reading as text or returning an unsupported format error
    return NextResponse.json(
      {
        error: `Unsupported file format (${extension || fileType || "unknown"}). Please upload a PDF document (.pdf) or image (.png, .jpg, .jpeg, .webp, .bmp, .tiff).`,
      },
      { status: 415 }
    );
  } catch (err) {
    console.error("parse-document route error:", err);
    return NextResponse.json(
      {
        error: `Server error while parsing document: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      },
      { status: 500 }
    );
  }
}
