import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// Agent/IDE terminals sometimes export ELECTRON_RUN_AS_NODE=1 (e.g. for their
// own Electron helpers). Electron treats the variable's presence as "run as
// plain Node", which crashes the main process, so strip it before spawning.
const require = createRequire(import.meta.url);
const electronPath = require("electron") as string;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, process.argv.slice(2), { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
