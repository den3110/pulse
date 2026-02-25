import mongoose, { Document, Schema } from "mongoose";

export interface IProcessInfo {
  pid: number;
  user: string;
  cpu: number;
  memory: number;
  command: string;
}

export interface IServerSnapshot extends Document {
  server: mongoose.Types.ObjectId;
  timestamp: Date;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  topProcesses: IProcessInfo[];
  networkStats: {
    totalConnections: number;
    established: number;
    timeWait: number;
  };
  recentLogs: string[];
}

const processSchema = new Schema<IProcessInfo>(
  {
    pid: { type: Number, required: true },
    user: { type: String, required: true },
    cpu: { type: Number, required: true },
    memory: { type: Number, required: true },
    command: { type: String, required: true },
  },
  { _id: false },
);

const serverSnapshotSchema = new Schema<IServerSnapshot>({
  server: { type: Schema.Types.ObjectId, ref: "Server", required: true },
  timestamp: { type: Date, required: true, default: Date.now },
  cpuUsage: { type: Number, required: true },
  memoryUsage: { type: Number, required: true },
  diskUsage: { type: Number, required: true },
  topProcesses: [processSchema],
  networkStats: {
    totalConnections: { type: Number, default: 0 },
    established: { type: Number, default: 0 },
    timeWait: { type: Number, default: 0 },
  },
  recentLogs: [{ type: String }],
});

// Index for efficient time-based queries per server
serverSnapshotSchema.index({ server: 1, timestamp: -1 });

export default mongoose.model<IServerSnapshot>(
  "ServerSnapshot",
  serverSnapshotSchema,
);
