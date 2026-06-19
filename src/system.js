const os = require("node:os");
const { execFile } = require("node:child_process");

function execFileText(command, args) {
  return new Promise((resolve) => {
    try {
      const child = execFile(command, args, { timeout: 3000 }, (error, stdout) => {
        resolve(error ? "" : stdout);
      });
      child.on("error", () => resolve(""));
    } catch {
      resolve("");
    }
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readCpuTimes() {
  return os.cpus().reduce(
    (acc, cpu) => {
      const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
      acc.total += total;
      acc.idle += cpu.times.idle;
      return acc;
    },
    { idle: 0, total: 0 },
  );
}

function calculateCpuPercent(start, end) {
  const total = end.total - start.total;
  const idle = end.idle - start.idle;
  if (total <= 0) return null;
  return Number((((total - idle) / total) * 100).toFixed(1));
}

async function getSystemCpuStats() {
  const start = readCpuTimes();
  await wait(120);
  const end = readCpuTimes();
  return {
    cores: os.cpus().length,
    usedPercent: calculateCpuPercent(start, end),
  };
}

function parseMacMemoryPressure(output) {
  const match = String(output || "").match(/System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/);
  if (!match) return null;
  return Number((100 - Number(match[1])).toFixed(1));
}

async function getSystemMemoryStats() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const rawUsedPercent = Number((((totalMem - freeMem) / totalMem) * 100).toFixed(1));
  const stats = {
    totalBytes: totalMem,
    freeBytes: freeMem,
    usedBytes: totalMem - freeMem,
    rawUsedPercent,
    usedPercent: rawUsedPercent,
    displayMode: "raw",
  };

  if (process.platform === "darwin") {
    const pressure = parseMacMemoryPressure(await execFileText("memory_pressure", ["-Q"]));
    if (Number.isFinite(pressure)) {
      stats.pressurePercent = pressure;
      stats.usedPercent = pressure;
      stats.displayMode = "pressure";
    }
  }

  return stats;
}

function safeUptime() {
  try {
    return Math.round(os.uptime());
  } catch {
    return 0;
  }
}

function safeLoadavg() {
  try {
    return os.loadavg();
  } catch {
    return [];
  }
}

async function getClaudeProcessStats() {
  if (process.platform === "win32") {
    const output = await execFileText("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'claude|Claude|anthropic' } | Select-Object ProcessId,CommandLine,WorkingSetSize | ConvertTo-Json -Compress",
    ]);
    try {
      const parsed = JSON.parse(output || "[]");
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const rssBytes = rows.reduce((sum, row) => sum + Number(row.WorkingSetSize || 0), 0);
      return { count: rows.length, cpuPercent: null, rssBytes };
    } catch {
      return { count: 0, cpuPercent: null, rssBytes: 0 };
    }
  }

  const output = await execFileText("ps", ["axo", "pid=,pcpu=,rss=,command="]);
  let count = 0;
  let cpuPercent = 0;
  let rssKb = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!/claude|Claude|anthropic/.test(line)) continue;
    if (/deepseek-cache-doctor|deepseek-monitor-assistant|TokenDoctor/.test(line)) continue;
    const parts = line.trim().split(/\s+/, 4);
    if (parts.length < 4) continue;
    count += 1;
    cpuPercent += Number(parts[1]) || 0;
    rssKb += Number(parts[2]) || 0;
  }
  return { count, cpuPercent: Number(cpuPercent.toFixed(1)), rssBytes: rssKb * 1024 };
}

async function getSystemStatus() {
  const [claude, cpu, memory] = await Promise.all([
    getClaudeProcessStats(),
    getSystemCpuStats(),
    getSystemMemoryStats(),
  ]);
  return {
    platform: process.platform,
    uptimeSec: safeUptime(),
    cpu,
    memory,
    loadavg: safeLoadavg(),
    claude,
  };
}

module.exports = {
  getSystemStatus,
  getClaudeProcessStats,
  getSystemCpuStats,
  getSystemMemoryStats,
  parseMacMemoryPressure,
};
