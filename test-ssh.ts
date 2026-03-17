import mongoose from "mongoose";
import * as dotenv from "dotenv";
import { Server } from "./src/models/Server";
import sshService from "./src/services/sshService";

dotenv.config();

(async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    await mongoose.connect(mongoUri as string);

    const server = await Server.findOne();
    if (!server) {
      console.log("No server found.");
      process.exit(1);
    }
    console.log("Checking openclaw logs on server:", server._id.toString());
    const { stdout, stderr, code } = await sshService.exec(
      server._id.toString(),
      "docker logs --tail 200 openclaw",
    );
    console.log("--- DOCKER LOGS ---");
    console.log(stdout);

    const { stdout: stdout2 } = await sshService.exec(
      server._id.toString(),
      "cat /root/openclaw/config.yaml",
    );
    console.log("\n--- CONFIG YAML ---");
    console.log(stdout2);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
