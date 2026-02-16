import mongoose from "mongoose";
import Server from "../models/Server";
import sshService from "../services/sshService";
import dotenv from "dotenv";
import path from "path";

// Load env
dotenv.config({ path: path.join(__dirname, "../../.env") });

const run = async () => {
  try {
    const mongoUri =
      process.env.MONGO_URI || "mongodb://localhost:27017/deploy-manager";
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    const server = await Server.findOne();
    if (!server) {
      console.log("No servers found");
      return;
    }

    console.log(`Testing stats for server: ${server.name} (${server.host})`);

    /*
    // Test specific commands to isolate the issue
    console.log("Testing vmstat 1 2...");
    const vmstatResult = await sshService.exec(
      server._id.toString(),
      "vmstat 1 2",
    );
    console.log("--- VMSTAT OUTPUT ---");
    console.log(vmstatResult.stdout);
    console.log("------------------");

    console.log("Testing free -m...");
    const freeResult = await sshService.exec(server._id.toString(), "free -m");
    console.log("--- FREE OUTPUT ---");
    console.log(freeResult.stdout);
    console.log("------------------");

    console.log("Testing df -P /...");
    const dfResult = await sshService.exec(server._id.toString(), "df -P /");
    console.log("--- DF OUTPUT ---");
    console.log(dfResult.stdout);
    console.log("------------------");
    */

    const stats = await sshService.getSystemStats(server._id.toString());
    console.log("--- FINAL PARSED STATS ---");
    console.log(JSON.stringify(stats, null, 2));
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
};

run();
