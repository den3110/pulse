const mongoose = require("mongoose");
const { Client } = require("ssh2");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

// Setup a minimal SSH service logic here to isolate from the existing service code
// (or I can import the existing service if I can deal with TS compilation)
// To be safe and see exactly what happens, I'll import the existing compiled service if possible,
// OR since I edited the TS file, the changes might not be compiled to JS yet if the user is using ts-node-dev for dev but running node for prod.
// Wait, the user is running `yarn dev` which uses `nodemon` + `ts-node` probably.
// So I should import the TS file via ts-node register in the script.

require("ts-node").register();
const Server = require("../models/Server").default;
const sshService = require("../services/sshService").default;

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

    // Capture console.log
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(" "));
      origLog(...args);
    };

    const stats = await sshService.getSystemStats(server._id.toString());

    fs.writeFileSync("debug_result.json", JSON.stringify(stats, null, 2));
    fs.writeFileSync("debug_logs.txt", logs.join("\n"));

    console.log("Done. Check debug_result.json and debug_logs.txt");
  } catch (error) {
    console.error("Error:", error);
    fs.writeFileSync("debug_error.txt", error.toString());
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
};

run();
