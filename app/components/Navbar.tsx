import Image from "next/image";

export default function Navbar() {
  return (
    <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 sm:px-8">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
            <Image
              src="/TSF.jpg"
              alt="TSF logo"
              width={56}
              height={56}
              className="h-full w-full object-cover"
            />
          </div>

          <div className="flex flex-col leading-tight">
            <p className="text-[1.02rem] font-semibold uppercase tracking-[0.32em] text-slate-900 sm:text-[1.18rem]">
              Electronic Stability Control
            </p>
            <p className="text-sm font-medium uppercase tracking-[0.28em] text-blue-700 sm:text-base">
              Testcase Automator
            </p>
          </div>
        </div>

        {/* <div className="hidden rounded-full border border-blue-100 bg-blue-50/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.24em] text-blue-700 sm:block">
          Automation Suite
        </div> */}
      </div>
    </header>
  );
}
