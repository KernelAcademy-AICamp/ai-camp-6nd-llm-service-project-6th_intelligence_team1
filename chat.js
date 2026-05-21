import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const client = new Anthropic();
const rl = readline.createInterface({ input, output });
const messages = [];

console.log("Claude와 대화를 시작합니다. 종료하려면 'exit' 또는 Ctrl+C를 누르세요.\n");

while (true) {
  let userInput;
  try {
    userInput = (await rl.question("나: ")).trim();
  } catch {
    break;
  }
  if (!userInput || userInput.toLowerCase() === "exit") break;

  messages.push({ role: "user", content: userInput });

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    messages,
  });

  const reply = response.content[0].text;
  messages.push({ role: "assistant", content: reply });

  console.log(`Claude: ${reply}\n`);
}

rl.close();
