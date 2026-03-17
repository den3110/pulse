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

    const { stdout, stderr } = await sshService.exec(
      server!._id.toString(),
      "cat /root/cliproxyapi/config.yaml",
    );
    console.log(stdout + "\n" + stderr);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
