import sshService from "./src/services/sshService";
import Server from "./src/models/Server";
import mongoose from "mongoose";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env" });

(async () => {
  try {
    const mongoUri = process.env.MONGO_URI;
    await mongoose.connect(mongoUri as string);

    const serverIdString = "69a04e3958619795da97d807";
    const server = await Server.findById(serverIdString);
    if (!server) throw new Error("Server not found");
    const serverId = server._id.toString();

    const { stdout } = await sshService.exec(serverId, "ufw status numbered");
    console.log("UFW Status:\n", stdout);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
