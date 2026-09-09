"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScanText, Sparkles, FileSpreadsheet } from "lucide-react";

const navLinks = [
  { href: "/", label: "Automator", icon: FileSpreadsheet },
  { href: "/standardizer", label: "Standardizer", icon: Sparkles },
  { href: "/parser", label: "Doc Parser", icon: ScanText },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#080c14]/80 backdrop-blur-xl supports-[backdrop-filter]:bg-[#080c14]/60">
      {/* Top accent line */}
      <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-blue-500/60 to-transparent" />

      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-5 sm:px-8">
        {/* Brand */}
        <div className="flex items-center gap-4">
          <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-slate-800 to-slate-900 shadow-lg shadow-black/20">
            <Image
              src="/TSF.jpg"
              alt="Brakes India Logo"
              width={36}
              height={36}
              className="h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-white/[0.08]" />
          </div>

          <div className="flex flex-col leading-none">
            <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-white">
              Brakes India
            </span>
            <span className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.1em] text-blue-400/80">
              Electronic Stability Control
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="hidden items-center gap-1 sm:flex">
          {navLinks.map((link) => {
            const Icon = link.icon;
            const isActive =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`group relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-white/[0.08] text-white shadow-sm"
                    : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
                }`}
              >
                <Icon
                  className={`h-[15px] w-[15px] transition-colors duration-200 ${
                    isActive
                      ? "text-blue-400"
                      : "text-slate-500 group-hover:text-slate-300"
                  }`}
                />
                {link.label}
                {isActive && (
                  <span className="absolute inset-x-3 -bottom-[13px] h-[2px] rounded-full bg-blue-500" />
                )}
              </Link>
            );
          })}
        </nav>

      </div>
    </header>
  );
}
