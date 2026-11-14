
"use client";

import {
  useState,
  type FormEvent,
} from "react";

import Link from "next/link";

import { authClient } from "@/lib/auth-client";

type ProtectedSessionResponse = {
  authenticated: boolean;
  user: {
    id: string;
    name: string;
    email: string;
  };
};

export default function LoginPage() {
  const {
    data: session,
    isPending,
    error: sessionError,
    refetch,
  } = authClient.useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [checkingApi, setCheckingApi] = useState(false);

  const [error, setError] = useState<string | null>(
    null,
  );

  const [apiStatus, setApiStatus] = useState<
    number | null
  >(null);

  const [apiSession, setApiSession] = useState<
    ProtectedSessionResponse | null
  >(null);

  async function handleLogin(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setError(null);
    setLoading(true);

    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
      });

      if (result.error) {
        setError(
          result.error.message ||
            "Incorrect email or password.",
        );
        return;
      }

      setPassword("");

      await refetch();
    } catch {
      setError(
        "Unable to connect to the server. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function checkProtectedApi() {
    setError(null);
    setApiStatus(null);
    setApiSession(null);
    setCheckingApi(true);

    try {
      const response = await fetch(
        "/api/v1/session",
        {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        },
      );

      setApiStatus(response.status);

      if (!response.ok) {
        setError(
          `Protected API returned HTTP ${response.status}.`,
        );
        return;
      }

      const data =
        (await response.json()) as ProtectedSessionResponse;

      setApiSession(data);
    } catch {
      setError(
        "Could not communicate with the protected API.",
      );
    } finally {
      setCheckingApi(false);
    }
  }

  async function handleSignOut() {
    setError(null);
    setSigningOut(true);

    try {
      const result = await authClient.signOut();

      if (result.error) {
        setError(
          result.error.message ||
            "Unable to sign out.",
        );
        return;
      }

      setApiStatus(null);
      setApiSession(null);
      setPassword("");

      await refetch();
    } catch {
      setError(
        "Unable to connect to the server while signing out.",
      );
    } finally {
      setSigningOut(false);
    }
  }

  if (isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p
          role="status"
          className="text-sm text-slate-600"
        >
          Checking your session...
        </p>
      </main>
    );
  }

  if (sessionError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8">
          <h1 className="text-xl font-semibold text-slate-900">
            Session check failed
          </h1>

          <p
            role="alert"
            className="mt-3 text-sm text-red-700"
          >
            {sessionError.message}
          </p>

          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold text-indigo-600">
            ToolTrack
          </p>

          <h1 className="mt-5 text-2xl font-semibold text-slate-900">
            You are signed in
          </h1>

          <p className="mt-3 text-sm text-slate-600">
            Welcome, {session.user.name}.
          </p>

          <div className="mt-5 rounded-lg bg-slate-50 p-4">
            <p className="text-xs text-slate-500">
              Email address
            </p>

            <p className="mt-1 break-all text-sm font-medium text-slate-900">
              {session.user.email}
            </p>
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={checkProtectedApi}
              disabled={checkingApi}
              className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {checkingApi
                ? "Checking API..."
                : "Test protected API"}
            </button>

            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full rounded-lg border border-slate-300 px-4 py-3 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {signingOut
                ? "Signing out..."
                : "Sign out"}
            </button>
          </div>

          {apiStatus !== null && (
            <p className="mt-5 text-sm text-slate-600">
              API status:{" "}
              <strong>{apiStatus}</strong>
            </p>
          )}

          {apiSession && (
            <div className="mt-4 rounded-lg bg-green-50 p-4">
              <p className="text-sm font-medium text-green-800">
                Protected API request successful
              </p>

              <pre className="mt-3 overflow-x-auto text-xs text-green-900">
                {JSON.stringify(
                  apiSession,
                  null,
                  2,
                )}
              </pre>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight text-indigo-600"
          >
            ToolTrack
          </Link>

          <h1 className="mt-6 text-2xl font-semibold text-slate-900">
            Welcome back
          </h1>

          <p className="mt-2 text-sm text-slate-600">
            Sign in to manage your software tools.
          </p>
        </div>

        <form
          onSubmit={handleLogin}
          className="space-y-5"
        >
          <div>
            <label
              htmlFor="login-email"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Email address
            </label>

            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="you@example.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Password
            </label>

            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              placeholder="Enter your password"
              className="w-full rounded-lg border border-slate-300 px-3 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          New to ToolTrack?{" "}
          <Link
            href="/register"
            className="font-medium text-indigo-600 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </section>
    </main>
  );
}
