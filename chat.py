from dotenv import load_dotenv
import anthropic

load_dotenv()

client = anthropic.Anthropic()
messages = []

print("Claude와 대화를 시작합니다. (종료: quit / exit / 빈 입력)\n")

while True:
    user_input = input("나: ").strip()
    if user_input.lower() in ("quit", "exit", ""):
        print("대화 종료.")
        break

    messages.append({"role": "user", "content": user_input})

    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=1024,
        messages=messages,
    )

    answer = response.content[0].text
    messages.append({"role": "assistant", "content": answer})

    print(f"\nClaude: {answer}\n")
