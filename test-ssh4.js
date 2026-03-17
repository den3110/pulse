const fs = require("fs");
const { Client } = require("ssh2");
const mongoose = require("mongoose");
require("dotenv").config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const db = mongoose.connection.db;
  const server = await db.collection("servers").findOne();

  const conn = new Client();
  conn
    .on("ready", () => {
      let out = "";
      conn.exec("docker logs --tail 250 openclaw", (err, stream) => {
        if (err) throw err;
        stream
          .on("close", (code, signal) => {
            fs.writeFileSync("openclaw-debug.txt", out);
            console.log("Saved to openclaw-debug.txt");
            conn.end();
            process.exit(0);
          })
          .on("data", (data) => {
            out += data.toString();
          })
          .stderr.on("data", (data) => {
            out += data.toString();
          });
      });
    })
    .connect({
      host: server.host,
      port: server.port,
      username: server.username,
      password: server.password,
      readyTimeout: 20000,
    });
});
