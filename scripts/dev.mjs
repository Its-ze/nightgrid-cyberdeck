import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const cwd = process.cwd();
const viteUrl = "http://127.0.0.1:5173";
const npmBin = isWindows ? "npm.cmd" : "npm";
const electronBin = path.join(cwd, "node_modules", ".bin", isWindows ? "electron.cmd" : "electron");

const children = [];

const start = (command, args, options = {}) => {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    ...options
  });
  children.push(child);
  return child;
};

const waitForVite = async () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const ready = await new Promise((resolve) => {
      const request = http.get(viteUrl, (response) => {
        response.resume();
        resolve(response.statusCode && response.statusCode < 500);
      });
      request.on("error", () => resolve(false));
      request.setTimeout(1000, () => {
        request.destroy();
        resolve(false);
      });
    });

    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  throw new Error(`Vite did not become ready at ${viteUrl}`);
};

const stopAll = () => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
};

process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

process.on("SIGTERM", () => {
  stopAll();
  process.exit(143);
});

const vite = start(npmBin, ["exec", "vite", "--", "--host", "127.0.0.1"]);
vite.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
});

await waitForVite();

const electron = start(electronBin, ["."], {
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: viteUrl
  }
});

electron.on("exit", (code) => {
  stopAll();
  process.exit(code ?? 0);
});
