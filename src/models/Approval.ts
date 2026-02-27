import mongoose, { Document, Schema } from "mongoose";

export interface IApproval extends Document {
  project: mongoose.Types.ObjectId;
  requestedBy: mongoose.Types.ObjectId;
  reviewers: mongoose.Types.ObjectId[];
  status: "pending" | "approved" | "rejected";
  type: "deploy" | "config_change" | "rollback" | "delete";
  title: string;
  description?: string;
  metadata?: Record<string, any>;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  reviewComment?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ApprovalSchema = new Schema<IApproval>(
  {
    project: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reviewers: [{ type: Schema.Types.ObjectId, ref: "User" }],
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    type: {
      type: String,
      enum: ["deploy", "config_change", "rollback", "delete"],
      required: true,
    },
    title: { type: String, required: true },
    description: String,
    metadata: Schema.Types.Mixed,
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    reviewComment: String,
    expiresAt: Date,
  },
  { timestamps: true },
);

ApprovalSchema.index({ status: 1, createdAt: -1 });
ApprovalSchema.index({ requestedBy: 1 });
ApprovalSchema.index({ reviewers: 1 });

export default mongoose.model<IApproval>("Approval", ApprovalSchema);
