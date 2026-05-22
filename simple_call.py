from dotenv import load_dotenv
load_dotenv()

import anthropic

client = anthropic.Anthropic()

MODEL = "claude-opus-4-5"
SYSTEM = "당신은 친절하고 도움이 되는 한국어 AI 어시스턴트입니다."

messages = []

print("채팅을 시작합니다. 종료하려면 'exit' 또는 'quit'을 입력하세요.\n")

while True:
    try:
        user_input = input("You: ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\n대화를 종료합니다.")
        break

    if not user_input:
        continue
    if user_input.lower() in {"exit", "quit", "종료"}:
        print("대화를 종료합니다.")
        break

    messages.append({"role": "user", "content": user_input})

    print("Claude: ", end="", flush=True)
    with client.messages.stream(
        model=MODEL,
        max_tokens=64000,
        system=SYSTEM,
        messages=messages,
    ) as stream:
        for text in stream.text_stream:
            print(text, end="", flush=True)
        final = stream.get_final_message()
    print("\n")

    assistant_text = next(
        (b.text for b in final.content if b.type == "text"), ""
    )
    messages.append({"role": "assistant", "content": assistant_text})
