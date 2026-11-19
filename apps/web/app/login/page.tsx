import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { getSession } from "@/lib/session-server";

export default async function LoginPage() {
  if (await getSession()) {
    redirect("/contracts");
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center text-2xl font-bold">stellarlens</h1>
        <LoginForm />
      </div>
    </main>
  );
}
