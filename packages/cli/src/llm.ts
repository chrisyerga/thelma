import { config } from "dotenv";
import path from "node:path";
import { repoRoot } from "./root.js";

config({ path: path.join(repoRoot(), ".env") });
config({ path: path.join(repoRoot(), ".env.local") });

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function llmConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl =
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const model = process.env.THELMA_MODEL ?? "anthropic/claude-sonnet-4";
  return { apiKey, baseUrl, model };
}

export async function chatCompletion(
  messages: ChatMessage[],
  opts?: { json?: boolean; temperature?: number },
): Promise<string> {
  const { apiKey, baseUrl, model } = llmConfig();
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY not set. Copy .env.example → .env and add your key.",
    );
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts?.temperature ?? 0.4,
  };
  if (opts?.json) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/chrisyerga/thelma",
      "X-Title": "Thelma",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM error ${res.status}: ${text.slice(0, 800)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty LLM response");
  return content;
}
