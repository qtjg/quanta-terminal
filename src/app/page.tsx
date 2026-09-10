/*
 * "/" IS the terminal — QUANTA is the only product in this repo.
 * Single source of truth: the /terminal page. This file re-exports it
 * so the root route renders the same UI (and returns 200, not a redirect).
 */
export { default, metadata, viewport } from "./terminal/page";
