import mongoose, { Document, Schema } from "mongoose";

export interface ISecurityScan extends Document {
  server: mongoose.Types.ObjectId;
  score: number;
  issues: {
    severity: "high" | "medium" | "low";
    description: string;
    recommendation: string;
  }[];
  passedChecks: string[];
  checks: {
    id: string;
    label: string;
    status: "pass" | "fail" | "warn" | "skip";
    severity: "high" | "medium" | "low" | "info";
    description: string;
    recommendation: string;
    details?: string;
    fixable?: boolean;
    fixCommand?: string;
  }[];
  scannedAt: Date;
}

const securityScanSchema = new Schema<ISecurityScan>({
  server: { type: Schema.Types.ObjectId, ref: "Server", required: true },
  score: { type: Number, required: true },
  issues: [
    {
      severity: { type: String, enum: ["high", "medium", "low"] },
      description: String,
      recommendation: String,
    },
  ],
  passedChecks: [{ type: String }],
  checks: [
    {
      id: String,
      label: String,
      status: String,
      severity: String,
      description: String,
      recommendation: String,
      details: String,
      fixable: Boolean,
      fixCommand: String,
    },
  ],
  scannedAt: { type: Date, default: Date.now },
});

// Index for getting a server's latest scans efficiently
securityScanSchema.index({ server: 1, scannedAt: -1 });

export default mongoose.model<ISecurityScan>(
  "SecurityScan",
  securityScanSchema,
);
