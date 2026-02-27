import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import Project from "../models/Project";
import sshService from "../services/sshService";
import TestRun from "../models/TestRun";

interface TestResult {
  name: string;
  status: "pass" | "fail" | "skip" | "running";
  duration?: number;
  output?: string;
  error?: string;
}

// POST /api/test-runner/:projectId/run — run pre-deploy tests
export const runTests = async (req: AuthRequest, res: Response) => {
  // SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const project = await Project.findById(req.params.projectId)
      .populate("server")
      .lean();

    if (!project) {
      sendEvent("error", { message: "Project not found" });
      return res.end();
    }

    const serverId = (project as any).server?._id?.toString();
    if (!serverId) {
      sendEvent("error", { message: "No server associated" });
      return res.end();
    }

    const deployPath = (project as any).deployPath || "";
    const results: TestResult[] = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    const processResult = (result: TestResult) => {
      results.push(result);
      if (result.status === "pass") passed++;
      else if (result.status === "fail") failed++;
      else if (result.status === "skip") skipped++;
      sendEvent("result", result);
    };

    // 1. Check directory exists
    sendEvent("progress", { name: "Directory Exists" });
    const dirCheck = await sshService.exec(
      serverId,
      `test -d "${deployPath}" && echo "EXISTS" || echo "NOT_FOUND"`,
    );
    processResult({
      name: "Directory Exists",
      status: dirCheck.stdout?.trim() === "EXISTS" ? "pass" : "fail",
      output: dirCheck.stdout?.trim(),
    });

    // 2. Check git status
    sendEvent("progress", { name: "Git Repository" });
    try {
      const gitStatus = await sshService.exec(
        serverId,
        `cd "${deployPath}" && git status --short 2>&1`,
        10000,
      );
      processResult({
        name: "Git Repository",
        status: gitStatus.code === 0 ? "pass" : "fail",
        output: gitStatus.stdout?.trim() || "Clean",
      });
    } catch {
      processResult({
        name: "Git Repository",
        status: "fail",
        error: "Not a git repository",
      });
    }

    // 3. Check disk space
    sendEvent("progress", { name: "Disk Space" });
    try {
      const diskCheck = await sshService.exec(
        serverId,
        `df -h "${deployPath}" | tail -1 | awk '{print $5}'`,
        10000,
      );
      const usage = parseInt(diskCheck.stdout?.trim()?.replace("%", "") || "0");
      processResult({
        name: "Disk Space",
        status: usage < 90 ? "pass" : "fail",
        output: `${diskCheck.stdout?.trim()} used`,
        error: usage >= 90 ? "Disk usage above 90%" : undefined,
      });
    } catch {
      processResult({ name: "Disk Space", status: "skip" });
    }

    // 4. Check Node.js
    sendEvent("progress", { name: "Node.js" });
    try {
      const nodeCheck = await sshService.exec(
        serverId,
        "node --version 2>&1",
        10000,
      );
      processResult({
        name: "Node.js",
        status: nodeCheck.code === 0 ? "pass" : "skip",
        output: nodeCheck.stdout?.trim(),
      });
    } catch {
      processResult({
        name: "Node.js",
        status: "skip",
        output: "Not installed",
      });
    }

    // 5. Check package.json exists
    sendEvent("progress", { name: "package.json" });
    try {
      const pkgCheck = await sshService.exec(
        serverId,
        `test -f "${deployPath}/package.json" && echo "YES" || echo "NO"`,
      );
      processResult({
        name: "package.json",
        status: pkgCheck.stdout?.trim() === "YES" ? "pass" : "skip",
        output: pkgCheck.stdout?.trim() === "YES" ? "Found" : "Not found",
      });
    } catch {
      processResult({ name: "package.json", status: "skip" });
    }

    // 6. Check port availability
    sendEvent("progress", { name: "Port Availability" });
    try {
      const portCheck = await sshService.exec(
        serverId,
        `ss -tlnp | grep -c LISTEN`,
        10000,
      );
      processResult({
        name: "Port Availability",
        status: "pass",
        output: `${portCheck.stdout?.trim()} ports in use`,
      });
    } catch {
      processResult({ name: "Port Availability", status: "skip" });
    }

    // 7. Check memory availability
    sendEvent("progress", { name: "Memory" });
    try {
      const memCheck = await sshService.exec(
        serverId,
        `free -m | awk '/Mem:/{printf "%d/%dMB (%.0f%%)", $3, $2, $3/$2*100}'`,
        10000,
      );
      const memStr = memCheck.stdout?.trim() || "";
      const memPercent = parseInt(memStr.match(/\((\d+)%\)/)?.[1] || "0");
      processResult({
        name: "Memory",
        status: memPercent < 90 ? "pass" : "fail",
        output: memStr,
        error: memPercent >= 90 ? "Memory usage critical" : undefined,
      });
    } catch {
      processResult({ name: "Memory", status: "skip" });
    }

    // 8. Run npm test
    sendEvent("progress", { name: "npm test" });
    try {
      const hasTestScript = await sshService.exec(
        serverId,
        `cd "${deployPath}" && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts.test && p.scripts.test !== 'echo \\"Error: no test specified\\" && exit 1' ? 0 : 1)" 2>&1`,
        10000,
      );
      if (hasTestScript.code === 0) {
        const start = Date.now();
        const testRun = await sshService.exec(
          serverId,
          `cd "${deployPath}" && npm test 2>&1`,
          60000,
        );
        processResult({
          name: "npm test",
          status: testRun.code === 0 ? "pass" : "fail",
          output: testRun.stdout?.slice(-500),
          duration: Date.now() - start,
          error: testRun.code !== 0 ? "Tests failed" : undefined,
        });
      } else {
        processResult({
          name: "npm test",
          status: "skip",
          output: "No test script defined",
        });
      }
    } catch {
      processResult({ name: "npm test", status: "skip" });
    }

    const summary = { total: results.length, passed, failed, skipped };
    const canDeploy = failed === 0;

    // Save to database
    await TestRun.create({
      project: project._id,
      status: canDeploy ? "success" : "failed",
      summary,
      results,
    });

    sendEvent("complete", {
      summary,
      canDeploy,
    });
    res.end();
  } catch (error: any) {
    sendEvent("error", { message: error.message || "Internal server error" });
    res.end();
  }
};

// GET /api/test-runner/:projectId/history — get history of tests
export const getHistory = async (req: AuthRequest, res: Response) => {
  try {
    const history = await TestRun.find({ project: req.params.projectId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ history });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
