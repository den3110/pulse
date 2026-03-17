import mongoose, { Document, Schema } from "mongoose";

export interface IOpenClawLog extends Document {
  serverId: mongoose.Types.ObjectId;
  timestamp: Date;
  content: string;
  type: "tool" | "thought" | "action" | "error" | "info";
  createdAt: Date;
}

const openClawLogSchema = new Schema<IOpenClawLog>(
  {
    serverId: {
      type: Schema.Types.ObjectId,
      ref: "Server",
      required: true,
      index: true,
    },
    timestamp: { type: Date, required: true },
    content: { type: String, required: true },
    type: {
      type: String,
      enum: ["tool", "thought", "action", "error", "info"],
      default: "info",
    },
  },
  {
    timestamps: true,
  },
);

// Compound index for dedup + pagination
openClawLogSchema.index({ serverId: 1, timestamp: -1 });
// Unique constraint to prevent duplicate entries
openClawLogSchema.index(
  { serverId: 1, timestamp: 1, content: 1 },
  { unique: true },
);
// TTL: auto-delete after 30 days
openClawLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);

export default mongoose.model<IOpenClawLog>("OpenClawLog", openClawLogSchema);
