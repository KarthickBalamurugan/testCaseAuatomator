"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScanText } from "lucide-react";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/parser", label: "Parser" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
            <Image
              src="/TSF.jpg"
              alt="Logo"
              width={32}
              height={32}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-white tracking-tight">
              ESC Testcase Automator
            </span>
            <span className="text-xs text-slate-500 hidden sm:inline">
            </span>
          </div>
        </div>

        <nav className="flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                {link.href === "/parser" && (
                  <ScanText className="h-4 w-4" />
                )}
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-xs text-slate-400 font-medium">Ready</span>
        </div>
      </div>
    </header>
  );
}
