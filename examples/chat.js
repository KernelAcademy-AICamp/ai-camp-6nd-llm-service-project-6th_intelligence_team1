import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import readline from "node:readline/promises";

const client = new Anthropic();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
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
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages,
  });

  const reply = response.content.find((b) => b.type === "text")?.text ?? "";
  messages.push({ role: "assistant", content: reply });

  console.log(`\nClaude: ${reply}\n`);
}

rl.close();
console.log("대화 종료.");
