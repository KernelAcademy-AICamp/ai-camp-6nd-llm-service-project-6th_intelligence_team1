import os
from dotenv import load_dotenv
import anthropic

load_dotenv()

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "안녕! 너 누구야? 한국어로 짧게 답해줘."}
    ],
)

print(response.content[0].text)
