import mongoose from "mongoose";
import Project from "../models/Project";
import Server from "../models/Server";
import sshService from "../services/sshService";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../../.env") });

const run = async () => {
  try {
    const mongoUri =
      process.env.MONGO_URI || "mongodb://localhost:27017/deploy-manager";
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    const projectId = "6991ac44466bb6d89e5c77b6";
    // Cast to any to bypass TS strict check on populate return type in this script
    const project: any = await Project.findById(projectId).populate("server");

    if (!project) {
      console.log(`Project ${projectId} not found`);
      return;
    }

    if (!project.server) {
      console.log("Project has no server assigned");
      return;
    }

    console.log(`Project: ${project.name}`);
    console.log(`Server: ${project.server.name} (${project.server.host})`);

    const serverId = project.server._id.toString();

    console.log(`Testing stats for server ID: ${serverId}`);

    const stats = await sshService.getSystemStats(serverId);
    console.log("--- STATS ---");
    console.log(JSON.stringify(stats, null, 2));
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
};

run();
