import mongoose, { Document, Schema } from "mongoose";

export interface IServerStats extends Document {
  server: mongoose.Types.ObjectId;
  cpu: number;
  memory: number;
  disk: number;
  timestamp: Date;
}

const serverStatsSchema = new Schema<IServerStats>(
  {
    server: {
      type: Schema.Types.ObjectId,
      ref: "Server",
      required: true,
      index: true,
    },
    cpu: { type: Number, required: true },
    memory: { type: Number, required: true },
    disk: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  {
    timestamps: false, // We use our own timestamp
  },
);

// TTL Index: Delete documents after 24 hours
serverStatsSchema.index({ timestamp: 1 }, { expireAfterSeconds: 86400 });

// Compound Index: Efficiently fetch stats for a specific server sorted by time
serverStatsSchema.index({ server: 1, timestamp: -1 });

export default mongoose.model<IServerStats>("ServerStats", serverStatsSchema);
