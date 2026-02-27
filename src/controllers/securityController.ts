import { Request, Response } from "express";
import {
  runSecurityScanStream,
  runRemediation,
} from "../services/securityService";
import SecurityScan from "../models/SecurityScan";
import Server from "../models/Server";
import { generateSecurityPdf } from "../services/pdfService";

// SSE endpoint — streams each check result as it completes
export const triggerScan = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const id = req.params.id as string;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const stream = runSecurityScanStream(id);
    for await (const event of stream) {
      if (event.type === "complete") {
        res.write(`event: complete\ndata: ${JSON.stringify(event.scan)}\n\n`);
      } else {
        res.write(`event: check\ndata: ${JSON.stringify(event)}\n\n`);
      }
    }
  } catch (error: any) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`,
    );
  } finally {
    res.end();
  }
};

// SSE endpoint — streams remediation steps
export const remediateCheck = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const serverId = req.params.id as string;
  const checkId = req.params.checkId as string;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  try {
    const stream = runRemediation(serverId, checkId);
    for await (const event of stream) {
      res.write(`event: step\ndata: ${JSON.stringify(event)}\n\n`);
    }
  } catch (error: any) {
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`,
    );
  } finally {
    res.end();
  }
};

export const getSecurityScans = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scans = await SecurityScan.find({ server: id })
      .sort({ scannedAt: -1 })
      .limit(20)
      .lean();
    res.json({ success: true, scans });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const downloadPdfReport = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scanId = req.params.scanId as string;

    const scan = await SecurityScan.findOne({ _id: scanId, server: id });
    if (!scan) {
      res.status(404).json({ success: false, message: "Scan not found" });
      return;
    }

    const server = await Server.findById(id);
    if (!server) {
      res.status(404).json({ success: false, message: "Server not found" });
      return;
    }

    const pdfBuffer = await generateSecurityPdf(scan, server.name);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=security-report-${server.name}.pdf`,
    );
    res.send(pdfBuffer);
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
