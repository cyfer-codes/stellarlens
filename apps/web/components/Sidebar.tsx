"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/app/(dashboard)/actions";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { href: "/contracts", label: "Contracts" },
  { href: "/events", label: "Events" },
  { href: "/transfers", label: "Transfers" },
  { href: "/settings", label: "Settings", requiresAuth: true }
];

export function Sidebar({ authenticated }: { authenticated: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const navItems = NAV_ITEMS.filter((item) => authenticated || !item.requiresAuth);

  return (
    <>
      {/* Mobile-only top bar. Hidden entirely at md and above, where the sidebar is always visible. */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 md:hidden">
        <span className="text-lg font-bold text-gray-900 dark:text-gray-100">stellarlens</span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="rounded p-2 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-6 w-6"
            aria-hidden="true"
            focusable="false"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
          </svg>
        </button>
      </header>

      {/* Backdrop, mobile only, only rendered while the drawer is open. */}
      {open && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} aria-hidden="true" />
      )}

      {/*
        Below md: fixed off-canvas drawer, slid in/out via translate-x, toggled by `open`.
        At md and above: md:static/md:translate-x-0 forces it back into normal flow, always visible —
        this exactly reproduces the pre-responsive behavior, unaffected by `open`.
      */}
      <nav
        className={`fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col border-r border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 transition-transform duration-200 ease-in-out md:static md:z-auto md:w-56 md:translate-x-0 md:transition-none ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-between px-3">
          <span className="text-lg font-bold text-gray-900 dark:text-gray-100">stellarlens</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 md:hidden"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-5 w-5"
              aria-hidden="true"
              focusable="false"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <ul className="flex-1 space-y-1">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`block rounded px-3 py-2 text-sm font-medium ${
                    active
                      ? "bg-gray-900 text-white dark:bg-gray-800 dark:text-gray-100"
                      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="hidden border-t border-gray-200 pt-4 dark:border-gray-800 md:block">
          <ThemeToggle />
        </div>

        {authenticated ? (
          <form action={logout} className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
            <button
              type="submit"
              className="w-full rounded px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Sign out
            </button>
          </form>
        ) : (
          <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="block rounded px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Sign in
            </Link>
          </div>
        )}
      </nav>
    </>
  );
}
