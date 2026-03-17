const { Client } = require("ssh2");
const mongoose = require("mongoose");
require("dotenv").config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const db = mongoose.connection.db;
  const server = await db.collection("servers").findOne();
  const conn = new Client();
  conn
    .on("ready", () => {
      const script = `
      cd /root/openclaw
      sed -i 's/openclaw daemon/openclaw gateway/g' docker-compose.yml
      docker compose up -d || docker-compose up -d
      sleep 10
      docker logs --tail 50 openclaw
    `;
      conn.exec(script, (err, stream) => {
        stream
          .on("close", () => {
            conn.end();
            process.exit(0);
          })
          .on("data", (d) => process.stdout.write(d))
          .stderr.on("data", (d) => process.stderr.write(d));
      });
    })
    .connect({
      host: server.host,
      port: server.port,
      username: server.username,
      password: server.password,
    });
});
