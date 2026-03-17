const { execSync } = require("child_process");
const mongoose = require("mongoose");
require("dotenv").config();

// Mongoose schema for Server
const serverSchema = new mongoose.Schema({
  ipAddress: String,
  sshPort: Number,
  sshKeyPath: String,
  sshUsername: String,
});
const Server = mongoose.model("Server", serverSchema);

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const server = await Server.findOne();
    if (!server) {
      console.log("No server found.");
      process.exit(1);
    }

    console.log(`Connecting to ${server.ipAddress}...`);

    const keyPath = `C:\\Users\\giang\\OneDrive\\Desktop\\gitpj\\manage-remote-deploy-git\\backend\\${server.sshKeyPath}`;

    // Build an SSH command. We use ssh.exe from Windows.
    const sshCmd = `ssh -i "${keyPath}" -p ${server.sshPort} -o StrictHostKeyChecking=no ${server.sshUsername}@${server.ipAddress} "docker logs --tail 200 openclaw"`;

    console.log("Running:", sshCmd);
    try {
      const output = execSync(sshCmd, { encoding: "utf-8", stdio: "pipe" });
      console.log("--- LOGS ---");
      console.log(output);
    } catch (e) {
      console.error("SSH Failed:", e.message);
      if (e.stderr) console.error(e.stderr.toString());
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
