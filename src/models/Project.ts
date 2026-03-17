import mongoose, { Document, Schema } from "mongoose";

export interface IProject extends Document {
  name: string;
  sourceType: "git" | "local";
  repoUrl?: string;
  branch?: string;
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
  environment?: "node" | "python" | "static" | "docker-compose";
  status: "idle" | "deploying" | "running" | "stopped" | "failed";
  order: number;
  processManager: "nohup" | "pm2";
  lastDeployedAt?: Date;
  lastFolderTimestamp?: string;
  healthCheck: {
    enabled: boolean;
    url: string;
    interval: number;
    lastStatus: "up" | "down" | "unknown";
    lastChecked?: Date;
    errorMessage?: string;
  };
  scheduledDeployAt?: Date;
  owner: mongoose.Types.ObjectId;
  team?: mongoose.Types.ObjectId;
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
    sourceType: {
      type: String,
      enum: ["git", "local"],
      default: "git",
    },
    repoUrl: {
      type: String,
      trim: true,
    },
    branch: {
      type: String,
      trim: true,
      default: "main",
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
    environment: {
      type: String,
      enum: ["node", "python", "static", "docker-compose"],
    },
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
    lastFolderTimestamp: {
      type: String,
      default: "",
    },
    healthCheck: {
      enabled: { type: Boolean, default: false },
      url: { type: String, default: "", trim: true },
      interval: { type: Number, default: 60 },
      lastStatus: {
        type: String,
        enum: ["up", "down", "unknown"],
        default: "unknown",
      },
      lastChecked: { type: Date },
      errorMessage: { type: String, default: "" },
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
    team: {
      type: Schema.Types.ObjectId,
      ref: "Team",
    },
  },
  {
    timestamps: true,
  },
);

export default mongoose.model<IProject>("Project", projectSchema);
