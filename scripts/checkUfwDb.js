const { Client } = require("ssh2");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, "../.env") });

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const Server = require("../src/models/Server").default;
  const server = await Server.findOne();

  if (!server) {
    console.log("No server found");
    process.exit(1);
  }

  const conn = new Client();
  conn
    .on("ready", () => {
      conn.exec(
        'ufw status && docker ps --format "{{.Names}} - {{.Ports}}"',
        (err, stream) => {
          if (err) throw err;
          stream
            .on("close", () => {
              conn.end();
              process.exit(0);
            })
            .on("data", (data) => {
              console.log("STDOUT:\n" + data);
            })
            .stderr.on("data", (data) => {
              console.log("STDERR:\n" + data);
            });
        },
      );
    })
    .connect({
      host: server.ip,
      port: 22,
      username: server.username,
      privateKey: server.privateKey,
    });
})();
