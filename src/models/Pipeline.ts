import mongoose, { Document, Schema } from "mongoose";

export interface IPipelineStep {
  name: string;
  type: "command" | "test" | "deploy" | "approval" | "notify";
  command?: string;
  config?: Record<string, any>;
  onFailure?: "stop" | "continue" | "rollback";
  timeout?: number;
}

export interface IPipeline extends Document {
  name: string;
  description?: string;
  project: mongoose.Types.ObjectId;
  owner: mongoose.Types.ObjectId;
  steps: IPipelineStep[];
  isActive: boolean;
  lastRunAt?: Date;
  lastRunStatus?: "success" | "failed" | "running";
  createdAt: Date;
  updatedAt: Date;
}

const PipelineStepSchema = new Schema(
  {
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["command", "test", "deploy", "approval", "notify"],
      required: true,
    },
    command: String,
    config: Schema.Types.Mixed,
    onFailure: {
      type: String,
      enum: ["stop", "continue", "rollback"],
      default: "stop",
    },
    timeout: { type: Number, default: 60000 },
  },
  { _id: false },
);

const PipelineSchema = new Schema<IPipeline>(
  {
    name: { type: String, required: true },
    description: String,
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
    steps: [PipelineStepSchema],
    isActive: { type: Boolean, default: true },
    lastRunAt: Date,
    lastRunStatus: { type: String, enum: ["success", "failed", "running"] },
  },
  { timestamps: true },
);

PipelineSchema.index({ project: 1 });
PipelineSchema.index({ owner: 1 });

export default mongoose.model<IPipeline>("Pipeline", PipelineSchema);
