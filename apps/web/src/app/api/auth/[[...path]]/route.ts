import { proxyApi } from "@/lib/api-proxy.mjs";

// Node.js is the default; Cache Components disallows a runtime segment override.
export const GET = proxyApi;
export const POST = proxyApi;
export const PUT = proxyApi;
export const PATCH = proxyApi;
export const DELETE = proxyApi;
export const HEAD = proxyApi;
export const OPTIONS = proxyApi;
