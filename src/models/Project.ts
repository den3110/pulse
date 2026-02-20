import mongoose, { Document, Schema } from "mongoose";

export interface IProject extends Document {
  name: string;
  repoUrl: string;
  branch: string;
  repoFolder?: string;
  server: mongoose.Types.ObjectId;
  deployPath: string;
  outputPath?: string;
  buildOutputDir?: string;
  buildCommand: string;
  installCommand: string;
  startCommand: string;
  stopCommand: string;
  preDeployCommand?: string;
  postDeployCommand?: string;
  envVars: Record<string, string>;
  autoDeploy: boolean;
  webhookSecret?: string;
  webhookRegistered?: boolean;
  githubRepoId?: string;
  githubRepoOwner?: string;
  githubRepoName?: string;
  githubRepoDefaultBranch?: string;
  status: "idle" | "deploying" | "running" | "stopped" | "failed";
  order: number;
  processManager: "nohup" | "pm2";
  lastDeployedAt?: Date;
  healthCheckUrl?: string;
  healthCheckInterval?: number;
  lastHealthCheck?: {
    status: "healthy" | "unhealthy" | "unknown";
    checkedAt: Date;
    responseTime?: number;
  };
  scheduledDeployAt?: Date;
  owner: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProject>(
  {
    name: {
      type: String,
      required: [true, "Project name is required"],
      trim: true,
    },
    repoUrl: {
      type: String,
      required: [true, "Repository URL is required"],
      trim: true,
    },
    branch: {
      type: String,
      default: "main",
      trim: true,
    },
    repoFolder: {
      type: String,
      default: "",
      trim: true,
    },
    server: {
      type: Schema.Types.ObjectId,
      ref: "Server",
      required: [true, "Server is required"],
    },
    deployPath: {
      type: String,
      required: [true, "Deploy path is required"],
      trim: true,
    },
    outputPath: {
      type: String,
      default: "",
      trim: true,
    },
    buildOutputDir: {
      type: String,
      default: "",
      trim: true,
    },
    buildCommand: {
      type: String,
      default: "npm install && npm run build",
      trim: true,
    },
    installCommand: {
      type: String,
      default: "npm install",
      trim: true,
    },
    startCommand: {
      type: String,
      default: "npm start",
      trim: true,
    },
    stopCommand: {
      type: String,
      default: "",
      trim: true,
    },
    envVars: {
      type: Map,
      of: String,
      default: {},
    },
    autoDeploy: {
      type: Boolean,
      default: false,
    },
    webhookSecret: {
      type: String,
      select: false,
    },
    githubRepoId: String,
    githubRepoOwner: String,
    githubRepoName: String,
    githubRepoDefaultBranch: String,
    webhookRegistered: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["idle", "deploying", "running", "stopped", "failed"],
      default: "idle",
    },
    order: {
      type: Number,
      default: 0,
    },
    processManager: {
      type: String,
      enum: ["nohup", "pm2"],
      default: "nohup",
    },
    lastDeployedAt: Date,
    healthCheckUrl: {
      type: String,
      default: "",
      trim: true,
    },
    healthCheckInterval: {
      type: Number,
      default: 60,
    },
    lastHealthCheck: {
      status: {
        type: String,
        enum: ["healthy", "unhealthy", "unknown"],
        default: "unknown",
      },
      checkedAt: Date,
      responseTime: Number,
    },
    preDeployCommand: {
      type: String,
      default: "",
      trim: true,
    },
    postDeployCommand: {
      type: String,
      default: "",
      trim: true,
    },
    scheduledDeployAt: {
      type: Date,
      default: null,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IProject>("Project", projectSchema);
