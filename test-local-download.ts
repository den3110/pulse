import * as https from "https";
import * as fs from "fs";
import * as cp from "child_process";

const url =
  "https://github.com/router-for-me/CLIProxyAPI/releases/latest/download/CLIProxyAPI_6.8.45_linux_amd64.tar.gz";
const file = fs.createWriteStream("cli.tar.gz");

https.get(url, (response) => {
  if (response.statusCode === 301 || response.statusCode === 302) {
    https.get(response.headers.location!, (res2) => {
      res2.pipe(file);
      file.on("finish", () => {
        file.close();
        cp.execSync("tar -xzf cli.tar.gz");
        console.log("Extracted!");
        if (fs.existsSync("config.yaml")) {
          console.log(fs.readFileSync("config.yaml", "utf8"));
        } else if (fs.existsSync("config.example.yaml")) {
          console.log(fs.readFileSync("config.example.yaml", "utf8"));
        }
      });
    });
  } else {
    response.pipe(file);
    file.on("finish", () => {
      file.close();
      cp.execSync("tar -xzf cli.tar.gz");
      console.log("Extracted!");
      if (fs.existsSync("config.yaml")) {
        console.log(fs.readFileSync("config.yaml", "utf8"));
      }
    });
  }
});
