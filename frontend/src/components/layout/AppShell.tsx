"use client";

import { X } from "lucide-react";
import { Suspense, useState, type ReactNode } from "react";
import { Header } from "./Header";
import { Logo, Sidebar } from "./Sidebar";

// Header and Sidebar read the current pathname, which is only known at request time on
// dynamic routes, so they stream in behind same-sized fallbacks.
function SidebarFallback() {
  return (
    <div className="py-6">
      <Logo />
    </div>
  );
}

function HeaderFallback() {
  return <div className="panel h-[66px]" />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border bg-bg-elevated/70 px-4 backdrop-blur lg:block">
        <Suspense fallback={<SidebarFallback />}>
          <Sidebar />
        </Suspense>
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-bg-elevated px-4">
            <button className="absolute right-3 top-4 p-1 text-text-2" onClick={() => setOpen(false)} aria-label="Close menu">
              <X size={18} />
            </button>
            <Suspense fallback={<SidebarFallback />}>
              <Sidebar onNavigate={() => setOpen(false)} />
            </Suspense>
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 lg:p-5">
        <Suspense fallback={<HeaderFallback />}>
          <Header onMenu={() => setOpen(true)} />
        </Suspense>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
