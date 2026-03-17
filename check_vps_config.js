const mongoose = require("mongoose");

const serverSchema = new mongoose.Schema({
  name: String,
  host: String,
  port: Number,
  username: String,
  authType: String,
  password: { type: String, select: true },
  privateKey: { type: String, select: true },
  passphrase: { type: String, select: true },
  status: String,
});

const Server = mongoose.model("Server", serverSchema);

mongoose
  .connect("mongodb://localhost:27017/manage-remote-deploy")
  .then(async () => {
    // get all
    const servers = await Server.find().select(
      "+password +privateKey +passphrase",
    );
    // Find the one with 76.13.218.20
    const server = servers.find(
      (s) => s.host === "76.13.218.20" || s.host === "vps1",
    );
    if (!server) {
      console.log(
        "No matching server found:",
        servers.map((s) => s.host),
      );
      process.exit(0);
    }

    console.log("Connecting to", server.host);
    const ssh = require("ssh2");
    const conn = new ssh.Client();

    conn
      .on("ready", () => {
        console.log("Connected");
        conn.exec("cat /root/cliproxyapi/config.yaml", (err, stream) => {
          if (err) throw err;
          stream
            .on("close", (code, signal) => {
              conn.end();
              process.exit(0);
            })
            .on("data", (data) => process.stdout.write(data))
            .stderr.on("data", (data) => process.stderr.write(data));
        });
      })
      .on("error", (err) => console.log("conn err:", err))
      .connect({
        host: server.host,
        port: server.port,
        username: server.username,
        privateKey: server.privateKey,
        password: server.password,
        passphrase: server.passphrase,
      });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
