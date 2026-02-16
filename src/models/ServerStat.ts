import mongoose, { Document, Schema } from "mongoose";

export interface IServerStat extends Document {
  server: mongoose.Types.ObjectId;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  timestamp: Date;
}

const serverStatSchema = new Schema<IServerStat>(
  {
    server: {
      type: Schema.Types.ObjectId,
      ref: "Server",
      required: true,
    },
    cpuUsage: {
      type: Number,
      required: true,
    },
    memoryUsage: {
      type: Number,
      required: true,
    },
    diskUsage: {
      type: Number,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false, // We use our own timestamp field
  },
);

// Compound index for fast retrieval of stats for a specific server
serverStatSchema.index({ server: 1, timestamp: -1 });

// TTL index to automatically delete stats older than 24 hours
serverStatSchema.index({ timestamp: 1 }, { expireAfterSeconds: 86400 });

export default mongoose.model<IServerStat>("ServerStat", serverStatSchema);
