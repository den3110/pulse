const fs = require("fs");
const { Client } = require("ssh2");

const conn = new Client();
conn
  .on("ready", () => {
    console.log("Client :: ready");
    conn.exec(
      'ufw status && docker ps --format "{{.Names}} {{.Ports}}"',
      (err, stream) => {
        if (err) throw err;
        stream
          .on("close", (code, signal) => {
            console.log(
              "Stream :: close :: code: " + code + ", signal: " + signal,
            );
            conn.end();
          })
          .on("data", (data) => {
            console.log("STDOUT: " + data);
          })
          .stderr.on("data", (data) => {
            console.log("STDERR: " + data);
          });
      },
    );
  })
  .connect({
    host: "76.13.218.20",
    port: 22,
    username: "root",
    privateKey: fs.readFileSync("C:/Users/giang/.ssh/id_rsa"), // Default windows SSH key path
  });
