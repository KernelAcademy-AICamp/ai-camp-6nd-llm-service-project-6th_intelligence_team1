import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-haiku-4-5",
  max_tokens: 1024,
  messages: [
    { role: "user", content: "안녕! 짧게 한국어로 인사해줘." },
  ],
});

for (const block of response.content) {
  if (block.type === "text") {
    console.log(block.text);
  }
}
