const mongoose = require("mongoose");
const Server = require("./src/models/Server").default;
const sshService = require("./src/services/sshService").default;

async function check() {
  await mongoose.connect("mongodb://127.0.0.1:27017/manage-remote-deploy");
  const server = await Server.findOne();
  if (!server) {
    console.log("No server found");
    process.exit(1);
  }
  console.log("Checking server:", server.host);
  const result = await sshService.exec(
    server._id.toString(),
    "cat /root/openclaw/config.yaml",
  );
  console.log("---- FILE CONTENT ----");
  console.log(result.stdout);
  console.log("---- STDERR ----");
  console.log(result.stderr);
  process.exit(0);
}

check();
