import sshService from "../src/services/sshService";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../../backend/.env") });

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log("Connected to DB");

    // Get the first server
    const Server = require("../src/models/Server").default;
    const server = await Server.findOne();

    if (server) {
      console.log(`Checking server: ${server.ip}`);
      const res = await sshService.exec(
        server._id.toString(),
        "ufw status",
        5000,
      );
      console.log("UFW STATUS:\n", res.stdout);

      const dockerRes = await sshService.exec(
        server._id.toString(),
        "docker ps --format '{{.Names}} {{.Ports}}'",
        5000,
      );
      console.log("\nDOCKER PORTS:\n", dockerRes.stdout);
    } else {
      console.log("No server found in DB.");
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
})();
