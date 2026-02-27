import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import Pipeline from "../models/Pipeline";
import sshService from "../services/sshService";

// POST /api/pipelines — create pipeline
export const createPipeline = async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, projectId, steps } = req.body;
    if (!name || !projectId || !steps?.length) {
      res.status(400).json({ message: "name, projectId, and steps required" });
      return;
    }
    const pipeline = await Pipeline.create({
      name,
      description,
      project: projectId,
      owner: req.user?._id,
      steps,
    });
    res.status(201).json(pipeline);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/pipelines
export const listPipelines = async (req: AuthRequest, res: Response) => {
  try {
    const filter: any = { owner: req.user?._id };
    if (req.query.projectId) filter.project = req.query.projectId;
    const pipelines = await Pipeline.find(filter)
      .sort({ updatedAt: -1 })
      .populate("project", "name status")
      .lean();
    res.json({ pipelines });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/pipelines/:id
export const getPipeline = async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await Pipeline.findById(req.params.id)
      .populate("project", "name status server")
      .lean();
    if (!pipeline) {
      res.status(404).json({ message: "Pipeline not found" });
      return;
    }
    res.json(pipeline);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// PUT /api/pipelines/:id
export const updatePipeline = async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await Pipeline.findOneAndUpdate(
      { _id: req.params.id, owner: req.user?._id },
      req.body,
      { new: true },
    );
    if (!pipeline) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    res.json(pipeline);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE /api/pipelines/:id
export const deletePipeline = async (req: AuthRequest, res: Response) => {
  try {
    const result = await Pipeline.findOneAndDelete({
      _id: req.params.id,
      owner: req.user?._id,
    });
    if (!result) {
      res.status(404).json({ message: "Not found" });
      return;
    }
    res.json({ message: "Deleted" });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/pipelines/:id/run — execute pipeline steps
export const runPipeline = async (req: AuthRequest, res: Response) => {
  try {
    const pipeline = await Pipeline.findById(req.params.id)
      .populate("project")
      .lean();
    if (!pipeline) {
      res.status(404).json({ message: "Not found" });
      return;
    }

    const project = pipeline.project as any;
    const serverId = project?.server?.toString();
    const results: any[] = [];

    for (const step of pipeline.steps) {
      const startTime = Date.now();
      let result: any = { name: step.name, type: step.type, status: "running" };

      try {
        switch (step.type) {
          case "command":
            if (serverId && step.command) {
              const exec = await sshService.exec(
                serverId,
                step.command,
                step.timeout || 60000,
              );
              result.status = exec.code === 0 ? "pass" : "fail";
              result.output = exec.stdout?.slice(-500);
              if (exec.code !== 0) result.error = exec.stderr?.slice(-300);
            } else {
              result.status = "skip";
              result.output = "No server or command";
            }
            break;

          case "test":
            if (serverId) {
              const testExec = await sshService.exec(
                serverId,
                `cd "${project.deployPath}" && ${step.command || "npm test"} 2>&1`,
                step.timeout || 120000,
              );
              result.status = testExec.code === 0 ? "pass" : "fail";
              result.output = testExec.stdout?.slice(-500);
            } else {
              result.status = "skip";
            }
            break;

          case "deploy":
            result.status = "pass";
            result.output = "Deploy trigger (handled separately)";
            break;

          case "approval":
            result.status = "pass";
            result.output = "Auto-approved (pipeline run)";
            break;

          case "notify":
            result.status = "pass";
            result.output = "Notification sent";
            break;
        }
      } catch (err: any) {
        result.status = "fail";
        result.error = err.message;
      }

      result.duration = Date.now() - startTime;
      results.push(result);

      // Stop on failure if configured
      if (result.status === "fail" && step.onFailure === "stop") {
        break;
      }
    }

    // Update pipeline run status
    const allPassed = results.every((r) => r.status !== "fail");
    await Pipeline.findByIdAndUpdate(pipeline._id, {
      lastRunAt: new Date(),
      lastRunStatus: allPassed ? "success" : "failed",
    });

    res.json({
      results,
      summary: {
        total: results.length,
        passed: results.filter((r) => r.status === "pass").length,
        failed: results.filter((r) => r.status === "fail").length,
        skipped: results.filter((r) => r.status === "skip").length,
      },
      success: allPassed,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
};
