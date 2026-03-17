import mongoose from "mongoose";
import * as dotenv from "dotenv";
import { Server } from "./src/models/Server";
import sshService from "./src/services/sshService";

dotenv.config();

(async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    await mongoose.connect(mongoUri as string);

    // Get the first server (assuming there's only one for testing)
    const server = await Server.findOne();
    if (!server) {
      console.log("No server found.");
      process.exit(1);
    }
    console.log("Checking openclaw logs on server:", server._id.toString());
    const { stdout, stderr, code } = await sshService.exec(
      server._id.toString(),
      "docker logs --tail 100 openclaw && echo '\\n--- CONFIG.YAML ---' && cat /root/openclaw/config.yaml",
    );
    console.log("--- LOGS ---");
    console.log(stdout);
    if (stderr && code !== 0) {
      console.log("--- STDERR ---");
      console.log(stderr);
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
