import mongoose, { Document, Schema } from "mongoose";

export interface IActivityLog extends Document {
  action: string;
  userId?: mongoose.Types.ObjectId;
  username?: string;
  details: string;
  ip?: string;
  createdAt: Date;
}

const activityLogSchema = new Schema<IActivityLog>(
  {
    action: {
      type: String,
      required: true,
      enum: [
        "login",
        "logout",
        "deploy",
        "rollback",
        "stop",
        "restart",
        "server.create",
        "server.update",
        "server.delete",
        "project.create",
        "project.update",
        "project.delete",
        "nginx.update",
        "settings.update",
        "user.create",
        "user.update",
        "user.delete",
        "password.change",
      ],
    },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    username: { type: String },
    details: { type: String, required: true },
    ip: { type: String },
  },
  {
    timestamps: true,
    // Auto-delete after 90 days
    expireAfterSeconds: 90 * 24 * 60 * 60,
  },
);

activityLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
activityLogSchema.index({ action: 1 });
activityLogSchema.index({ userId: 1 });

export default mongoose.model<IActivityLog>("ActivityLog", activityLogSchema);
