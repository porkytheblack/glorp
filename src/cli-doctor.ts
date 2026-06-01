/**
 * `glorp doctor` — diagnose and clean up stale glorp runtime state.
 *
 * Reports the registered server, any running glorp processes (TUIs, servers,
 * spawned subprocess agents), and removes a stale `server.json` whose process
 * is gone. With `--kill`, terminates the listed glorp processes — useful when a
 * runaway/abandoned glorp is starving the machine (the classic "zsh: killed
 * glorp" on the next launch).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { discoverServer } from "./client/discovery.ts";
import type { CliArgs } from "./cli-args.ts";

interface Proc { pid: number; rssMB: number; etime: string; command: string; }

/** Match genuine glorp runtime invocations, not just any process whose cwd
 *  happens to be a "glorp" directory. */
function isGlorpProcess(cmd: string): boolean {
  if (/\bgrep\b|\bps -axo\b|cli-doctor/.test(cmd)) return false;
  return /(?:^|\/)glorp(?:\s|$)/.test(cmd)   // the `glorp` binary
    || /\bsrc\/cli\.ts\b/.test(cmd)          // dev entrypoint
    || /agent-entrypoint/.test(cmd);         // spawned subprocess agents
}

function findGlorpProcesses(): Proc[] {
  let out = "";
  try { out = execSync("ps -axo pid=,rss=,etime=,command=", { encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 }); }
  catch { return []; }
  const procs: Proc[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid || pid === process.ppid) continue;
    if (!isGlorpProcess(m[4]!)) continue;
    procs.push({ pid, rssMB: Math.round(Number(m[2]) / 1024), etime: m[3]!, command: m[4]! });
  }
  return procs;
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export async function runDoctor(args: CliArgs): Promise<void> {
  const dataDir = process.env.GLORP_DATA_DIR ?? path.join(os.homedir(), ".glorp");
  console.log(`glorp doctor — data dir: ${dataDir}`);

  // 1. Registered server.
  const serverFile = path.join(dataDir, "server.json");
  const server = await discoverServer(dataDir);
  if (server) {
    console.log(`\n● live server: pid ${server.pid} · port ${server.port} · ${server.workspace}`);
  } else if (fs.existsSync(serverFile)) {
    try { fs.rmSync(serverFile, { force: true }); console.log("\n✓ removed stale server.json (its process is gone)"); }
    catch { console.log("\n⚠ could not remove stale server.json"); }
  } else {
    console.log("\n● no server registered");
  }

  // 2. Running glorp processes.
  const procs = findGlorpProcesses();
  if (procs.length === 0) {
    console.log("\n● no other glorp processes running");
  } else {
    console.log(`\nfound ${procs.length} glorp process(es):`);
    for (const p of procs) {
      console.log(`  pid ${String(p.pid).padEnd(7)} ${String(p.rssMB).padStart(5)}MB  up ${p.etime.padStart(8)}  ${clip(p.command, 66)}`);
    }
    if (args.doctorKill) {
      console.log("\nterminating…");
      for (const p of procs) { try { process.kill(p.pid, "SIGTERM"); } catch {} }
      await new Promise((r) => setTimeout(r, 800));
      for (const p of procs) {
        try { process.kill(p.pid, 0); process.kill(p.pid, "SIGKILL"); console.log(`  ⛔ force-killed ${p.pid}`); }
        catch { console.log(`  ✓ stopped ${p.pid}`); }
      }
      // The processes we just killed may have left a stale server.json behind.
      try {
        const after = await discoverServer(dataDir);
        if (!after && fs.existsSync(serverFile)) { fs.rmSync(serverFile, { force: true }); console.log("  ✓ cleared now-stale server.json"); }
      } catch {}
    } else {
      console.log("\nRun `glorp doctor --kill` to terminate the processes above.");
    }
  }

  console.log("\ndone.");
}
