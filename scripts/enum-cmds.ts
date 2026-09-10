import { ALL_COMMANDS } from "../src/components/quanta/commands";

console.log("TOTAL:", ALL_COMMANDS.length);
const byCat: Record<string, string[]> = {};
for (const c of ALL_COMMANDS) (byCat[c.cat] ??= []).push(`${c.name} — ${c.desc}`);
for (const [cat, list] of Object.entries(byCat)) {
  console.log(`\n[${cat}] (${list.length})`);
  for (const l of list.sort()) console.log("  " + l);
}
