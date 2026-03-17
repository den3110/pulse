import sshService from "./sshService";
import { detectProjectWithAI } from "./aiService";

/**
 * Project detection result
 */
export interface DetectedProject {
  framework: string;
  frameworkIcon: string;
  displayName: string;
  description: string;

  // Detected commands
  installCommand: string;
  buildCommand: string;
  startCommand: string;
  stopCommand: string;

  // Paths
  buildOutputDir: string;
  deployPath: string;

  // Server requirements
  requiredTools: string[];
  environment: string;

  // Extra info
  nodeVersion?: string;
  pythonVersion?: string;
  envVarsFromExample?: Record<string, string>;
  hasDockerfile: boolean;
  hasDockerCompose: boolean;

  // Confidence 0-100
  confidence: number;
}

/**
 * File check result from scanning repo
 */
interface RepoFiles {
  packageJson?: any;
  hasNextConfig: boolean;
  hasViteConfig: boolean;
  hasAngularJson: boolean;
  hasNuxtConfig: boolean;
  hasDockerfile: boolean;
  hasDockerCompose: boolean;
  hasRequirementsTxt: boolean;
  hasPipfile: boolean;
  hasSetupPy: boolean;
  hasGemfile: boolean;
  hasGoMod: boolean;
  hasCargoToml: boolean;
  hasIndexHtml: boolean;
  hasWpConfig: boolean;
  envExample: string;
  fileList: string[];
}

/**
 * Analyze a Git repository on a server to detect project type and generate deploy config
 */
export async function analyzeRepo(
  serverId: string,
  repoUrl: string,
  branch: string = "main",
  onProgress?: (message: string) => void,
): Promise<DetectedProject> {
  const tmpDir = `/tmp/pulse-detect-${Date.now()}`;

  try {
    // 1. Shallow clone into temp directory
    onProgress?.("Cloning repository...");
    const cloneResult = await sshService.exec(
      serverId,
      `git clone --depth 1 --branch ${branch} ${repoUrl} ${tmpDir} 2>&1 || git clone --depth 1 ${repoUrl} ${tmpDir} 2>&1`,
    );

    // Verify clone succeeded
    const checkDir = await sshService.exec(
      serverId,
      `[ -d "${tmpDir}" ] && echo "OK" || echo "FAIL"`,
    );
    if (checkDir.stdout.trim() !== "OK") {
      throw new Error(
        `Git clone failed for ${repoUrl}. Output:\n${cloneResult.stdout}\n(URL might be invalid, private repo, or not a git repository)`,
      );
    }

    // 2. Scan for key files
    onProgress?.("Scanning repository files...");
    const files = await scanRepoFiles(serverId, tmpDir);

    // 3. Extract Repo Name
    const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "my-site";

    // 4. Try AI Detection First
    onProgress?.("Analyzing project structure with AI...");
    const aiPrompt = `Please analyze the following project repository and determine the deployment configuration.
Repo Name: ${repoName}
Files in root directory: 
${files.fileList.join("\n")}

Package.json (if exists):
${files.packageJson ? JSON.stringify(files.packageJson, null, 2) : "No package.json found"}

.env.example content:
${files.envExample || "No .env.example found"}
`;

    let result: DetectedProject | null = null;

    // Attempt AI detection
    result = await detectProjectWithAI(aiPrompt);

    // 5. Fallback to rule-based logic if AI fails or returns very low confidence
    if (!result || result.confidence < 50) {
      console.log(
        "[projectDetector] AI detection failed or low confidence. Falling back to rule-based detection.",
      );
      onProgress?.("AI detection skipped. Using rule-based detection...");
      result = detectFramework(files, repoUrl);
    } else {
      console.log(
        `[projectDetector] AI detection successful (confidence: ${result.confidence}%)`,
      );
      onProgress?.("AI successfully detected project type.");
      // Ensure deployPath is correct just in case AI generates a weird one
      if (!result.deployPath) result.deployPath = `/var/www/${repoName}`;
    }

    // 6. Cleanup temp dir
    onProgress?.("Cleaning up...");
    await sshService.exec(serverId, `rm -rf ${tmpDir}`).catch(() => {});

    return result;
  } catch (error: any) {
    // Cleanup on error
    await sshService.exec(serverId, `rm -rf ${tmpDir}`).catch(() => {});
    throw new Error(`Failed to analyze repository: ${error.message}`);
  }
}

/**
 * Scan repo directory for key files
 */
async function scanRepoFiles(
  serverId: string,
  dir: string,
): Promise<RepoFiles> {
  // Fix: use semicolons and subshells to avoid || breaking the chain
  const checkScript = `
    cd ${dir} || exit 1;
    echo "===START===";
    ls -1 2>/dev/null;
    echo "===PKG===";
    if [ -f package.json ]; then cat package.json; else echo "{}"; fi;
    echo "===ENV===";
    if [ -f .env.example ]; then cat .env.example; elif [ -f .env.sample ]; then cat .env.sample; else echo ""; fi;
    echo "===END==="
  `;

  const result = await sshService.exec(serverId, checkScript);
  const output = result.stdout;
  const fileListSection =
    output.split("===START===")[1]?.split("===PKG===")[0]?.trim() || "";
  const pkgSection =
    output.split("===PKG===")[1]?.split("===ENV===")[0]?.trim() || "{}";
  const envSection =
    output.split("===ENV===")[1]?.split("===END===")[0]?.trim() || "";

  const fileList = fileListSection.split("\n").filter(Boolean);

  let packageJson: any = null;
  try {
    const parsed = JSON.parse(pkgSection);
    if (parsed && Object.keys(parsed).length > 0) packageJson = parsed;
  } catch {
    packageJson = null;
  }

  return {
    packageJson,
    hasNextConfig: fileList.some((f: string) => f.startsWith("next.config")),
    hasViteConfig: fileList.some((f: string) => f.startsWith("vite.config")),
    hasAngularJson: fileList.includes("angular.json"),
    hasNuxtConfig: fileList.some((f: string) => f.startsWith("nuxt.config")),
    hasDockerfile:
      fileList.includes("Dockerfile") || fileList.includes("dockerfile"),
    hasDockerCompose: fileList.some(
      (f: string) =>
        f === "docker-compose.yml" ||
        f === "docker-compose.yaml" ||
        f === "compose.yml" ||
        f === "compose.yaml",
    ),
    hasRequirementsTxt: fileList.includes("requirements.txt"),
    hasPipfile: fileList.includes("Pipfile"),
    hasSetupPy: fileList.includes("setup.py"),
    hasGemfile: fileList.includes("Gemfile"),
    hasGoMod: fileList.includes("go.mod"),
    hasCargoToml: fileList.includes("Cargo.toml"),
    hasIndexHtml: fileList.includes("index.html"),
    hasWpConfig:
      fileList.includes("wp-config.php") ||
      fileList.includes("wp-config-sample.php"),
    envExample: envSection,
    fileList,
  };
}

/**
 * Detect framework from scanned files — comprehensive rule-based detection
 */
function detectFramework(files: RepoFiles, repoUrl: string): DetectedProject {
  const pkg = files.packageJson;
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const scripts = pkg?.scripts || {};
  const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "my-site";
  const fileList = files.fileList;

  // Helper
  const hasDep = (...names: string[]) => names.some((n) => !!deps?.[n]);
  const hasFile = (...names: string[]) =>
    names.some((n) => fileList.includes(n));
  const hasFileStartsWith = (...prefixes: string[]) =>
    prefixes.some((p) => fileList.some((f: string) => f.startsWith(p)));

  const baseResult = {
    deployPath: `/var/www/${repoName}`,
    hasDockerfile: files.hasDockerfile,
    hasDockerCompose: files.hasDockerCompose,
    envVarsFromExample: parseEnvExample(files.envExample),
    nodeVersion: pkg?.engines?.node,
  };

  // ─── Docker Compose (highest priority) ───
  if (files.hasDockerCompose) {
    return {
      ...baseResult,
      framework: "docker-compose",
      frameworkIcon: "🐳",
      displayName: "Docker Compose",
      description: "Multi-container Docker application",
      installCommand: "",
      buildCommand: "",
      startCommand: "docker-compose up -d --build",
      stopCommand: "docker-compose down",
      buildOutputDir: "",
      requiredTools: ["docker", "docker-compose"],
      environment: "docker-compose",
      confidence: 95,
    };
  }

  // ─── Dockerfile only (no package.json) ───
  if (files.hasDockerfile && !pkg) {
    return {
      ...baseResult,
      framework: "docker",
      frameworkIcon: "🐳",
      displayName: "Docker",
      description: "Containerized application",
      installCommand: "",
      buildCommand: `docker build -t ${repoName} .`,
      startCommand: `docker run -d --name ${repoName} -p 3000:3000 ${repoName}`,
      stopCommand: `docker stop ${repoName} && docker rm ${repoName}`,
      buildOutputDir: "",
      requiredTools: ["docker"],
      environment: "docker-compose",
      confidence: 90,
    };
  }

  // ─── Next.js ───
  if (files.hasNextConfig || hasDep("next")) {
    return {
      ...baseResult,
      framework: "nextjs",
      frameworkIcon: "▲",
      displayName: "Next.js",
      description: "React framework with SSR and static generation",
      installCommand: "yarn install",
      buildCommand: "yarn build",
      startCommand: "yarn start",
      stopCommand: "",
      buildOutputDir: ".next",
      requiredTools: ["node", "pm2"],
      environment: "node",
      confidence: 95,
    };
  }

  // ─── Nuxt.js ───
  if (files.hasNuxtConfig || hasDep("nuxt", "nuxt3")) {
    return {
      ...baseResult,
      framework: "nuxt",
      frameworkIcon: "💚",
      displayName: "Nuxt.js",
      description: "Vue.js framework with SSR",
      installCommand: "yarn install",
      buildCommand: "yarn build",
      startCommand: "node .output/server/index.mjs",
      stopCommand: "",
      buildOutputDir: ".output",
      requiredTools: ["node", "pm2"],
      environment: "node",
      confidence: 92,
    };
  }

  // ─── Remix ───
  if (hasDep("@remix-run/node", "@remix-run/react", "@remix-run/serve")) {
    return {
      ...baseResult,
      framework: "remix",
      frameworkIcon: "💿",
      displayName: "Remix",
      description: "Full-stack React framework",
      installCommand: "yarn install",
      buildCommand: "yarn build",
      startCommand: "yarn start",
      stopCommand: "",
      buildOutputDir: "build",
      requiredTools: ["node", "pm2"],
      environment: "node",
      confidence: 92,
    };
  }

  // ─── Astro ───
  if (hasDep("astro") || hasFileStartsWith("astro.config")) {
    const isSSR = !!deps?.["@astrojs/node"];
    return {
      ...baseResult,
      framework: "astro",
      frameworkIcon: "🚀",
      displayName: "Astro",
      description: isSSR
        ? "Astro SSR application"
        : "Astro static site — served via Nginx",
      installCommand: "yarn install",
      buildCommand: "yarn build",
      startCommand: isSSR ? "node dist/server/entry.mjs" : "",
      stopCommand: "",
      buildOutputDir: "dist",
      requiredTools: isSSR ? ["node", "pm2"] : ["node", "nginx"],
      environment: isSSR ? "node" : "static",
      confidence: 90,
    };
  }

  // ─── Gatsby ───
  if (hasDep("gatsby")) {
    return {
      ...baseResult,
      framework: "gatsby",
      frameworkIcon: "💜",
      displayName: "Gatsby",
      description: "React static site generator — served via Nginx",
      installCommand: "yarn install",
      buildCommand: "yarn build",
      startCommand: "",
      stopCommand: "",
      buildOutputDir: "public",
      requiredTools: ["node", "nginx"],
      environment: "static",
      confidence: 90,
    };
  }

  // ─── SvelteKit ───
  if (hasDep("@sveltejs/kit")) {
    return {
      ...baseResult,
      framework: "sveltekit",
      frameworkIcon: "🔥",
      displayName: "SvelteKit",
      description: "Full-stack Svelte framework",
      installCommand: "yarn install",
      buildCommand: "yarn build",
      startCommand: "node build",
      stopCommand: "",
      buildOutputDir: "build",
      requiredTools: ["node", "pm2"],
      environment: "node",
      confidence: 90,
    };
  }

  // ─── Vite (React/Vue/Svelte/Solid) ───
  if (files.hasViteConfig || hasDep("vite")) {
    const isReact = hasDep("react");
    const isVue = hasDep("vue");
    const isSvelte = hasDep("svelte");
    const isSolid = hasDep("solid-js");
    const name = isReact
      ? "React (Vite)"
      : isVue
        ? "Vue (Vite)"
        : isSvelte
          ? "Svelte (Vite)"
          : isSolid
            ? "Solid (Vite)"
            : "Vite App";
    return {
      ...baseResult,
      framework: "vite",
      frameworkIcon: isReact ? "⚛️" : isVue ? "💚" : "⚡",
      displayName: name,
      description: `Static ${name} — served via Nginx`,
      installCommand: "yarn install",
      buildCommand: scripts.build || "yarn build",
      startCommand: "",
      stopCommand: "",
      buildOutputDir: "dist",
      requiredTools: ["node", "nginx"],
      environment: "static",
      confidence: 90,
    };
  }

  // ─── Angular ───
  if (files.hasAngularJson || hasDep("@angular/core")) {
    return {
      ...baseResult,
      framework: "angular",
      frameworkIcon: "🅰️",
      displayName: "Angular",
      description: "Angular app — served via Nginx",
      installCommand: "yarn install",
      buildCommand: scripts.build || "ng build --configuration production",
      startCommand: "",
      stopCommand: "",
      buildOutputDir: `dist/${repoName}`,
      requiredTools: ["node", "nginx"],
      environment: "static",
      confidence: 90,
    };
  }

  // ─── Create React App ───
  if (hasDep("react-scripts")) {
    return {
      ...baseResult,
      framework: "cra",
      frameworkIcon: "⚛️",
      displayName: "Create React App",
      description: "React app (CRA) — served via Nginx",
      installCommand: "yarn install",
      buildCommand: "yarn build",
      startCommand: "",
      stopCommand: "",
      buildOutputDir: "build",
      requiredTools: ["node", "nginx"],
      environment: "static",
      confidence: 88,
    };
  }

  // ─── Vue CLI ───
  if (hasDep("@vue/cli-service")) {
    return {
      ...baseResult,
      framework: "vue-cli",
      frameworkIcon: "💚",
      displayName: "Vue CLI",
      description: "Vue CLI app — served via Nginx",
      installCommand: "yarn install",
      buildCommand: "yarn build",
      startCommand: "",
      stopCommand: "",
      buildOutputDir: "dist",
      requiredTools: ["node", "nginx"],
      environment: "static",
      confidence: 88,
    };
  }

  // ─── NestJS ───
  if (hasDep("@nestjs/core")) {
    return {
      ...baseResult,
      framework: "nestjs",
      frameworkIcon: "🐱",
      displayName: "NestJS",
      description: "NestJS server application managed by PM2",
      installCommand: "yarn install",
      buildCommand: "yarn build",
      startCommand: "node dist/main.js",
      stopCommand: "",
      buildOutputDir: "dist",
      requiredTools: ["node", "pm2"],
      environment: "node",
      confidence: 90,
    };
  }

  // ─── Express / Fastify / Koa / Hapi / Generic Node server ───
  if (
    pkg &&
    (hasDep("express", "fastify", "koa", "@hapi/hapi", "hono") || scripts.start)
  ) {
    const framework = hasDep("express")
      ? "Express"
      : hasDep("fastify")
        ? "Fastify"
        : hasDep("koa")
          ? "Koa"
          : hasDep("@hapi/hapi")
            ? "Hapi"
            : hasDep("hono")
              ? "Hono"
              : "Node.js";
    return {
      ...baseResult,
      framework: "node",
      frameworkIcon: "⬢",
      displayName: `${framework} Server`,
      description: `${framework} application managed by PM2`,
      installCommand: "yarn install",
      buildCommand: scripts.build || "",
      startCommand: scripts.start || "node index.js",
      stopCommand: "",
      buildOutputDir: "",
      requiredTools: ["node", "pm2"],
      environment: "node",
      confidence: 82,
    };
  }

  // ─── Python: Django ───
  if (hasFile("manage.py") && files.hasRequirementsTxt) {
    return {
      ...baseResult,
      framework: "django",
      frameworkIcon: "🐍",
      displayName: "Django",
      description: "Django web application",
      installCommand: "pip install -r requirements.txt",
      buildCommand: "python manage.py collectstatic --noinput",
      startCommand: "gunicorn config.wsgi:application --bind 0.0.0.0:8000",
      stopCommand: "",
      buildOutputDir: "",
      requiredTools: ["python3", "pip", "gunicorn"],
      environment: "python",
      confidence: 88,
    };
  }

  // ─── Python: Flask / FastAPI / General ───
  if (files.hasRequirementsTxt || files.hasPipfile || files.hasSetupPy) {
    const hasFlask =
      files.envExample?.includes("FLASK") || hasFile("wsgi.py", "app.py");
    const hasFastAPI = hasFile("main.py");
    const name = hasFlask ? "Flask" : hasFastAPI ? "FastAPI" : "Python";
    const startCmd = hasFlask
      ? "gunicorn app:app --bind 0.0.0.0:5000"
      : hasFastAPI
        ? "uvicorn main:app --host 0.0.0.0 --port 8000"
        : "python app.py";
    return {
      ...baseResult,
      framework: name.toLowerCase(),
      frameworkIcon: "🐍",
      displayName: name,
      description: `${name} application`,
      installCommand: files.hasRequirementsTxt
        ? "pip install -r requirements.txt"
        : files.hasPipfile
          ? "pipenv install"
          : "pip install .",
      buildCommand: "",
      startCommand: startCmd,
      stopCommand: "",
      buildOutputDir: "",
      requiredTools: ["python3", "pip"],
      environment: "python",
      confidence: 80,
    };
  }

  // ─── Go ───
  if (files.hasGoMod) {
    return {
      ...baseResult,
      framework: "go",
      frameworkIcon: "🐹",
      displayName: "Go",
      description: "Go application",
      installCommand: "",
      buildCommand: `go build -o ${repoName}`,
      startCommand: `./${repoName}`,
      stopCommand: "",
      buildOutputDir: "",
      requiredTools: ["go"],
      environment: "node",
      confidence: 85,
    };
  }

  // ─── Rust ───
  if (files.hasCargoToml) {
    return {
      ...baseResult,
      framework: "rust",
      frameworkIcon: "🦀",
      displayName: "Rust",
      description: "Rust application",
      installCommand: "",
      buildCommand: "cargo build --release",
      startCommand: `./target/release/${repoName}`,
      stopCommand: "",
      buildOutputDir: "target/release",
      requiredTools: ["cargo", "rustc"],
      environment: "node",
      confidence: 85,
    };
  }

  // ─── Ruby on Rails ───
  if (files.hasGemfile && hasFile("Rakefile", "config.ru")) {
    return {
      ...baseResult,
      framework: "rails",
      frameworkIcon: "💎",
      displayName: "Ruby on Rails",
      description: "Rails web application",
      installCommand: "bundle install",
      buildCommand: "RAILS_ENV=production bundle exec rake assets:precompile",
      startCommand: "bundle exec puma -C config/puma.rb",
      stopCommand: "",
      buildOutputDir: "",
      requiredTools: ["ruby", "bundler"],
      environment: "node",
      confidence: 85,
    };
  }

  // ─── Ruby (generic) ───
  if (files.hasGemfile) {
    return {
      ...baseResult,
      framework: "ruby",
      frameworkIcon: "💎",
      displayName: "Ruby",
      description: "Ruby application",
      installCommand: "bundle install",
      buildCommand: "",
      startCommand: "bundle exec ruby app.rb",
      stopCommand: "",
      buildOutputDir: "",
      requiredTools: ["ruby", "bundler"],
      environment: "node",
      confidence: 70,
    };
  }

  // ─── Laravel (PHP) ───
  if (hasFile("artisan", "composer.json") && hasFile("artisan")) {
    return {
      ...baseResult,
      framework: "laravel",
      frameworkIcon: "🔴",
      displayName: "Laravel",
      description: "Laravel PHP application",
      installCommand: "composer install --no-dev --optimize-autoloader",
      buildCommand: "php artisan config:cache && php artisan route:cache",
      startCommand: "php artisan serve --host=0.0.0.0 --port=8000",
      stopCommand: "",
      buildOutputDir: "public",
      requiredTools: ["php", "composer", "nginx"],
      environment: "node",
      confidence: 88,
    };
  }

  // ─── WordPress ───
  if (files.hasWpConfig) {
    return {
      ...baseResult,
      framework: "wordpress",
      frameworkIcon: "📝",
      displayName: "WordPress",
      description: "WordPress site — requires PHP and MySQL",
      installCommand: "",
      buildCommand: "",
      startCommand: "",
      stopCommand: "",
      buildOutputDir: "",
      requiredTools: ["php", "mysql", "nginx"],
      environment: "static",
      confidence: 80,
    };
  }

  // ─── PHP generic ───
  if (hasFile("composer.json", "index.php")) {
    return {
      ...baseResult,
      framework: "php",
      frameworkIcon: "🐘",
      displayName: "PHP",
      description: "PHP application — served via Nginx + PHP-FPM",
      installCommand: hasFile("composer.json") ? "composer install" : "",
      buildCommand: "",
      startCommand: "",
      stopCommand: "",
      buildOutputDir: "",
      requiredTools: ["php", "nginx"],
      environment: "static",
      confidence: 70,
    };
  }

  // ─── Hugo ───
  if (
    hasFile("hugo.toml", "hugo.yaml", "hugo.json") ||
    (hasFileStartsWith("config.toml") && hasFile("archetypes"))
  ) {
    return {
      ...baseResult,
      framework: "hugo",
      frameworkIcon: "📰",
      displayName: "Hugo",
      description: "Hugo static site — served via Nginx",
      installCommand: "",
      buildCommand: "hugo --minify",
      startCommand: "",
      stopCommand: "",
      buildOutputDir: "public",
      requiredTools: ["hugo", "nginx"],
      environment: "static",
      confidence: 85,
    };
  }

  // ─── Jekyll ───
  if (hasFile("_config.yml") && files.hasGemfile) {
    return {
      ...baseResult,
      framework: "jekyll",
      frameworkIcon: "🧪",
      displayName: "Jekyll",
      description: "Jekyll static site — served via Nginx",
      installCommand: "bundle install",
      buildCommand: "bundle exec jekyll build",
      startCommand: "",
      stopCommand: "",
      buildOutputDir: "_site",
      requiredTools: ["ruby", "nginx"],
      environment: "static",
      confidence: 85,
    };
  }

  // ─── Static HTML ───
  if (files.hasIndexHtml) {
    return {
      ...baseResult,
      framework: "static",
      frameworkIcon: "📄",
      displayName: "Static Website",
      description: "Static HTML/CSS/JS — served via Nginx",
      installCommand: "",
      buildCommand: "",
      startCommand: "",
      stopCommand: "",
      buildOutputDir: "",
      requiredTools: ["nginx"],
      environment: "static",
      confidence: 75,
    };
  }

  // ─── Fallback: generic Node.js project with package.json ───
  if (pkg) {
    return {
      ...baseResult,
      framework: "node",
      frameworkIcon: "⬢",
      displayName: "Node.js Project",
      description: "Node.js project — detected package.json",
      installCommand: "yarn install",
      buildCommand: scripts.build ? "yarn build" : "",
      startCommand: scripts.start || "node index.js",
      stopCommand: "",
      buildOutputDir: scripts.build ? "dist" : "",
      requiredTools: ["node", "pm2"],
      environment: "node",
      confidence: 60,
    };
  }

  // ─── Dockerfile with package.json (already handled above but edge case) ───
  if (files.hasDockerfile) {
    return {
      ...baseResult,
      framework: "docker",
      frameworkIcon: "🐳",
      displayName: "Docker",
      description: "Containerized application",
      installCommand: "",
      buildCommand: `docker build -t ${repoName} .`,
      startCommand: `docker run -d --name ${repoName} -p 3000:3000 ${repoName}`,
      stopCommand: `docker stop ${repoName} && docker rm ${repoName}`,
      buildOutputDir: "",
      requiredTools: ["docker"],
      environment: "docker-compose",
      confidence: 85,
    };
  }

  // ─── Unknown ───
  return {
    framework: "unknown",
    frameworkIcon: "❓",
    displayName: "Unknown Project",
    description: "Could not determine project type. Please configure manually.",
    installCommand: "",
    buildCommand: "",
    startCommand: "",
    stopCommand: "",
    buildOutputDir: "",
    deployPath: `/var/www/${repoName}`,
    requiredTools: [],
    environment: "node",
    hasDockerfile: false,
    hasDockerCompose: false,
    confidence: 0,
  };
}

/**
 * Parse .env.example content into key-value pairs
 */
function parseEnvExample(content: string): Record<string, string> {
  if (!content) return {};
  const result: Record<string, string> = {};
  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      result[key] = val;
    }
  });
  return result;
}

export default { analyzeRepo };
