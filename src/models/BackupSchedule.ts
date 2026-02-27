import mongoose, { Document, Schema } from "mongoose";

export interface IBackupSchedule extends Document {
  server: mongoose.Types.ObjectId;
  containerId: string;
  dbType: "postgres" | "mysql" | "mongo";
  dbName?: string;
  dbUser?: string;
  dbPassword?: string;
  schedule: string; // Cron expression
  retentionDays: number; // Number of days to keep backups
  status: "active" | "paused";
  lastRun?: Date;
  lastStatus?: "success" | "failed";
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BackupScheduleSchema = new Schema<IBackupSchedule>(
  {
    server: {
      type: Schema.Types.ObjectId,
      ref: "Server",
      required: true,
    },
    containerId: {
      type: String,
      required: true,
    },
    dbType: {
      type: String,
      enum: ["postgres", "mysql", "mongo"],
      required: true,
    },
    dbName: {
      type: String,
    },
    dbUser: {
      type: String,
    },
    dbPassword: {
      type: String,
    },
    schedule: {
      type: String,
      required: true,
      default: "0 0 * * *", // Every midnight
    },
    retentionDays: {
      type: Number,
      required: true,
      default: 7, // Keep for 7 days
    },
    status: {
      type: String,
      enum: ["active", "paused"],
      default: "active",
    },
    lastRun: {
      type: Date,
    },
    lastStatus: {
      type: String,
      enum: ["success", "failed"],
    },
    lastError: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

export const BackupSchedule = mongoose.model<IBackupSchedule>(
  "BackupSchedule",
  BackupScheduleSchema,
);
