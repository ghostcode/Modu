#!/usr/bin/env node
import path from "node:path";
import { execFileSync } from "node:child_process";
import { root } from "./version.mjs";

if (process.platform !== "win32")
  throw Error("Windows 构建脚本只能在 Windows 上运行。");

const args = ["build", ...process.argv.slice(2)];
const env = { ...process.env };

// MSVC is the default and recommended Tauri target on Windows. When the host only
// has a GNU toolchain, opt in explicitly with MODU_WINDOWS_TARGET=gnu.
const target = (process.env.MODU_WINDOWS_TARGET ?? "").toLowerCase();
if (target === "gnu") {
  args.push("--target", "x86_64-pc-windows-gnu");
  const mingw = env.MINGW_BIN ?? "C:\\msys64\\mingw64\\bin";
  env.PATH = `${mingw};${env.PATH ?? ""}`;
} else if (target && target !== "msvc") {
  throw Error("MODU_WINDOWS_TARGET 只支持 msvc 或 gnu。");
}

const tauri = path.join(root, "node_modules", ".bin", "tauri.cmd");
execFileSync(tauri, args, {
  cwd: root,
  env,
  stdio: "inherit",
  shell: true,
});
