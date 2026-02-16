import mongoose, { Document, Schema } from "mongoose";

export interface IDeployment extends Document {
  project: mongoose.Types.ObjectId;
  server: mongoose.Types.ObjectId;
  commitHash?: string;
  commitMessage?: string;
  commitAuthor?: string;
  branch: string;
  status:
    | "pending"
    | "cloning"
    | "installing"
    | "building"
    | "starting"
    | "running"
    | "failed"
    | "stopped";
  logs: any[];
  triggeredBy: "manual" | "webhook" | "schedule";
  triggeredByUser?: mongoose.Types.ObjectId;
  errorMessage?: string;
  startedAt: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const deploymentSchema = new Schema<IDeployment>(
  {
    project: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    server: {
      type: Schema.Types.ObjectId,
      ref: "Server",
      required: true,
    },
    commitHash: String,
    commitMessage: String,
    commitAuthor: String,
    branch: {
      type: String,
      default: "main",
    },
    status: {
      type: String,
      enum: [
        "pending",
        "cloning",
        "installing",
        "building",
        "starting",
        "running",
        "failed",
        "stopped",
      ],
      default: "pending",
    },
    logs: {
      type: Schema.Types.Mixed,
      default: [],
    },
    triggeredBy: {
      type: String,
      enum: ["manual", "webhook", "schedule"],
      default: "manual",
    },
    triggeredByUser: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    errorMessage: String,
    startedAt: {
      type: Date,
      default: Date.now,
    },
    finishedAt: Date,
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IDeployment>("Deployment", deploymentSchema);
