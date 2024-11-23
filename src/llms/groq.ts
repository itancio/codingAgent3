import { Groq } from "groq-sdk";
import { env } from "../env";
import { ChatCompletionCreateParamsBase } from "groq-sdk/resources/chat/completions";

export const groq = new Groq({
  apiKey: env.GROQ_API_KEY,
});

export type GroqChatModel = ChatCompletionCreateParamsBase["model"];

export const GROQ_MODEL: GroqChatModel =  "llama3-groq-70b-8192-tool-use-preview";
