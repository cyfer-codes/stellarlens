import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

const FEATURES = [
  {
    title: "Poll & decode",
    description: "Polls Soroban RPC for a contract's events and decodes them — raw XDR alongside native values."
  },
  {
    title: "Track transfers",
    description: "Detects SEP-41 token transfers automatically and tracks volume, senders, and receivers."
  },
  {
    title: "Signed webhooks",
    description: "Fires signed webhooks to your own endpoints as new events land, so you can react in real time."
  },
  {
    title: "Dashboard, API, SDK, CLI",
    description: "Surfaces everything in a web dashboard, a REST api, a typed SDK, and a CLI — pick what fits."
  }
];

export default async function LandingPage() {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (token && (await verifySessionToken(token))) {
    redirect("/contracts");
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-gray-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold">stellarlens</span>
          <Link
            href="/login"
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Indexing and monitoring for Soroban contracts</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-500">
          Register a contract address on Stellar, and stellarlens indexes its events, tracks token
          transfers, and delivers signed webhooks as new activity lands.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/login"
            className="rounded bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Sign in
          </Link>
          <a
            href="#architecture"
            className="rounded border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            View demo
          </a>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded border border-gray-200 p-4">
              <div className="text-sm font-medium text-gray-900">{feature.title}</div>
              <p className="mt-1 text-sm text-gray-500">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="architecture" className="mx-auto max-w-5xl px-6 py-12">
        <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">Architecture at a glance</h2>

        <div className="mt-4 overflow-x-auto rounded border border-gray-200 p-6">
          <div className="flex min-w-[640px] items-center justify-center gap-3 text-sm">
            <div className="rounded border border-gray-300 px-3 py-2 text-center">Soroban RPC</div>
            <span className="text-gray-400">→</span>
            <div className="rounded border border-gray-900 bg-gray-900 px-3 py-2 text-center text-white">Indexer</div>
            <span className="text-gray-400">→</span>
            <div className="rounded border border-gray-300 px-3 py-2 text-center">Postgres</div>
            <span className="text-gray-400">↔</span>
            <div className="rounded border border-gray-300 px-3 py-2 text-center">API</div>
            <span className="text-gray-400">→</span>
            <div className="rounded border border-gray-300 px-3 py-2 text-center">Dashboard / SDK / CLI</div>
          </div>
          <div className="mt-3 flex min-w-[640px] justify-center text-sm">
            <div className="flex items-center gap-3">
              <span className="text-gray-400">↳</span>
              <div className="rounded border border-gray-300 px-3 py-2 text-center">Your webhook endpoints</div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-sm text-gray-500">
          The indexer polls Soroban RPC and writes events, transfers, and checkpoints to Postgres, then
          delivers signed webhooks to your registered endpoints. Everything else — the dashboard, the SDK,
          and the CLI — reads and writes through the api, which is the single source of truth gated by an
          api key.
        </p>
      </section>

      <footer className="border-t border-gray-200">
        <div className="mx-auto max-w-5xl px-6 py-6 text-sm text-gray-500">
          <a
            href="https://github.com/cyfer-codes/stellarlens"
            className="hover:text-gray-900"
            target="_blank"
            rel="noreferrer"
          >
            View source on GitHub
          </a>
        </div>
      </footer>
    </main>
  );
}
