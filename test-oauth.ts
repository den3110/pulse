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

    console.log("Testing OAuth fetch script with localadmin123...");

    const portCmd = `grep "port:" /root/cliproxyapi/config.yaml | head -1 | awk '{print $2}'`;
    let portOutput = (
      await sshService.exec(server!._id.toString(), portCmd)
    ).stdout.trim();
    if (!portOutput) portOutput = "8317";

    const fetchUrlCmd = `
      curl -sS -H "Authorization: Bearer localadmin123" "http://localhost:${portOutput}/v0/management/gemini-cli-auth-url?is_webui=true"
    `;

    const { stdout, stderr } = await sshService.exec(
      server!._id.toString(),
      fetchUrlCmd,
    );

    const fs = require("fs");
    fs.writeFileSync("debug-oauth.txt", stdout + "\n\n" + stderr);
    console.log("Saved to debug-oauth.txt");
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
