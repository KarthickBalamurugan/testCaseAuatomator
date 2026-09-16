# MBD Testcase Automator

A set of tools for preparing test requirements and generating MATLAB / Simulink test suites for Electronic Stability Control (ESC) development.

## Tools

| Page | Route | Purpose |
| --- | --- | --- |
| **Testcase Standardizer** | `/standardizer` | Upload a requirements workbook and get a standardized test-case document ready for automation. Uses the **Gemini** API. |
| **Test Generator** | `/test-generator` | Feed standardized test requirements and I/O ports to generate a MATLAB Simulink test suite. Uses the **OpenRouter** API. |
| **Document Parser** | `/parser` | Extract structured requirements from PDF documents and export them to Excel or JSON. |

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Environment Variables

Create a `.env.local` file in the project root:

```
GEMINI_API_KEY=your_gemini_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
```

- `GEMINI_API_KEY` — used by the Testcase Standardizer (`app/api/standardize/route.ts`).
- `OPENROUTER_API_KEY` — used by the Test Generator (`lib/llmClient.ts` → `app/api/generate-testsuite/route.ts`).

## Project Structure

```
app/
  page.tsx                    # Landing page
  standardizer/page.tsx       # Testcase Standardizer UI
  test-generator/page.tsx     # Test Generator UI
  parser/page.tsx             # Document Parser UI
  api/
    standardize/route.ts      # Gemini standardization endpoint
    generate-testsuite/route.ts  # MATLAB test suite generation endpoint
    parse-document/route.ts   # PDF/image parsing endpoint
  components/                 # Navbar, PageTransition
lib/
  llmClient.ts                # OpenRouter client (OpenAI SDK)
  generateMatlabTestSuite.ts  # MATLAB .m generation prompt logic
  excelParser.ts              # Test-case workbook parsing
  portExcelParser.ts          # I/O ports workbook parsing
  requirementParser.ts        # PDF requirement extraction
  standardizer-types.ts       # Shared types
public/
  pdf.worker.min.mjs          # pdfjs-dist worker
  TSF.jpg                     # Navbar logo
```