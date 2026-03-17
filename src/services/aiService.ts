import OpenAI from "openai";
import { DetectedProject } from "./projectDetector";

export interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function getAIConfig(): AIConfig | null {
  const apiKey = process.env.AI_API_KEY || "";
  const baseUrl = process.env.AI_BASE_URL || "https://openrouter.ai/api/v1";
  const model = process.env.AI_MODEL || "openai/gpt-4o-mini";

  if (!apiKey) return null;

  return { apiKey, baseUrl, model };
}

export function createOpenAIClient(): {
  client: OpenAI;
  model: string;
} | null {
  const config = getAIConfig();
  if (!config) return null;

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });

  return { client, model: config.model };
}

export async function detectProjectWithAI(
  prompt: string,
): Promise<DetectedProject | null> {
  const aiClient = createOpenAIClient();
  if (!aiClient) return null;

  const { client, model } = aiClient;

  const systemPrompt = `You are an expert DevOps engineer and project detector. 
Your task is to analyze file lists and package contents to determine the exact project framework and deployment configuration.
You must return a raw JSON object matching this TypeScript interface exactly:

interface DetectedProject {
  framework: string; // e.g. "nextjs", "vite", "docker", "django", "node", "unknown"
  frameworkIcon: string; // an emoji representing the framework
  displayName: string;
  description: string;
  installCommand: string; // empty string if not applicable
  buildCommand: string; // empty string if not applicable
  startCommand: string;
  stopCommand: string; // empty string except for docker-compose
  buildOutputDir: string; // e.g. ".next", "dist", ".output", or empty for SSR/Docker
  deployPath: string; // Should be /var/www/<repoName> (you will be given repoName)
  requiredTools: string[]; // e.g. ["node", "pm2", "nginx"], ["docker"], ["python3"]
  environment: string; // "node", "static", "docker-compose", "python"
  nodeVersion?: string; // extracted from package.json if available
  pythonVersion?: string;
  envVarsFromExample?: Record<string, string>; // extracted from .env.example
  hasDockerfile: boolean;
  hasDockerCompose: boolean;
  confidence: number; // 0 to 100
}

Return ONLY the raw JSON object. Do not wrap in markdown \`\`\`json blocks. Do not include any reasoning or comments. Ensure it is valid JSON.`;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return null;

    // Sometimes models ignore the instruction and wrap in ```json anyway
    const cleanedContent = content.replace(/^```json\n?|```$/g, "").trim();

    return JSON.parse(cleanedContent) as DetectedProject;
  } catch (error) {
    console.error("[aiService] Error detecting project with AI:", error);
    return null;
  }
}
