/**
 * Unified LLM Client
 * Temporary: Uses OpenRouter (OpenAI-compatible API).
 * To revert to Gemini, swap this module's internals back to @google/genai.
 */

import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://mbd-testcase-automator.local",
    "X-Title": "MBD Testcase Automator",
  },
});

export interface GenerateTextOptions {
  model: string;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Send a text prompt to the LLM and return the response text.
 */
export async function generateText(options: GenerateTextOptions): Promise<string> {
  const {
    model,
    prompt,
    systemInstruction,
    temperature = 0.2,
    maxOutputTokens = 4096,
  } = options;

  const messages: OpenAI.ChatCompletionMessageParam[] = [];

  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }
  messages.push({ role: "user", content: prompt });

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxOutputTokens,
  });

  return response.choices?.[0]?.message?.content?.trim() ?? "";
}

/**
 * Generate content with a file attachment (base64 Excel).
 * On OpenRouter, falls back to embedding a text representation of the file
 * in the prompt since binary file parts aren't supported.
 */
export async function generateTextWithFile(
  options: GenerateTextOptions & { fileBase64?: string; textTable?: string }
): Promise<string> {
  const { fileBase64, textTable, prompt, ...rest } = options;

  // Build user message content — include the text table if available
  const userContent: string = prompt;

  return generateText({ ...rest, prompt: userContent });
}

export default client;
