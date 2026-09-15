import Link from "next/link";
import { Sparkles, Code2, ScanText } from "lucide-react";
import Navbar from "./components/Navbar";

const tools = [
  {
    href: "/standardizer",
    title: "Testcase Standardizer",
    description:
      "Upload a requirements workbook and get a standardized test-case document ready for automation.",
    icon: Sparkles,
    accent: "from-blue-500/20 to-cyan-500/5",
    iconColor: "text-blue-400",
  },
  {
    href: "/test-generator",
    title: "Test Generator",
    description:
      "Feed standardized test requirements and I/O ports to generate a MATLAB Simulink test suite.",
    icon: Code2,
    accent: "from-emerald-500/20 to-teal-500/5",
    iconColor: "text-emerald-400",
  },
  {
    href: "/parser",
    title: "Document Parser",
    description:
      "Extract structured requirements from PDF documents and export them to Excel or JSON.",
    icon: ScanText,
    accent: "from-violet-500/20 to-purple-500/5",
    iconColor: "text-violet-400",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col items-center justify-center px-5 py-20 sm:px-8">
        {/* Hero */}
        <div className="mb-14 max-w-2xl text-center">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-400">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            MBD Toolchain
          </span>

          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            MBD Testcase Automator
          </h1>

          <p className="mt-5 text-[15px] leading-relaxed text-slate-400 sm:text-base">
            A set of tools for preparing test requirements and generating
            MATLAB / Simulink test suites for Electronic Stability Control
            development.
          </p>
        </div>

        {/* Tool cards */}
        <div className="grid w-full max-w-4xl gap-5 sm:grid-cols-3">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.href}
                href={tool.href}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.16] hover:bg-white/[0.05] hover:shadow-xl hover:shadow-black/30"
              >
                <div
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tool.accent} opacity-0 transition-opacity duration-300 group-hover:opacity-100`}
                />

                <div className="relative mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-slate-900/80 shadow-lg shadow-black/20">
                  <Icon className={`h-5 w-5 ${tool.iconColor}`} />
                </div>

                <h2 className="relative text-[15px] font-semibold text-white">
                  {tool.title}
                </h2>

                <p className="relative mt-2 flex-1 text-[13px] leading-relaxed text-slate-400">
                  {tool.description}
                </p>

                <span className="relative mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-blue-400 transition-colors group-hover:text-blue-300">
                  Open
                  <span className="transition-transform duration-300 group-hover:translate-x-1">
                    →
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}