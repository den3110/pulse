import mongoose, { Document, Schema } from "mongoose";

export interface ITestRun extends Document {
  project: mongoose.Types.ObjectId;
  status: "success" | "failed";
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  results: {
    name: string;
    status: "pass" | "fail" | "skip" | "running";
    duration?: number;
    output?: string;
    error?: string;
  }[];
  createdAt: Date;
}

const testRunSchema = new Schema(
  {
    project: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["success", "failed"],
      required: true,
    },
    summary: {
      total: Number,
      passed: Number,
      failed: Number,
      skipped: Number,
    },
    results: [
      {
        name: String,
        status: String,
        duration: Number,
        output: String,
        error: String,
      },
    ],
  },
  { timestamps: true },
);

export default mongoose.model<ITestRun>("TestRun", testRunSchema);
