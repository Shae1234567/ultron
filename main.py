import os
import sys
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables from a .env file if present
load_dotenv()

# Check for API key
api_key = os.environ.get("OPENAI_API_KEY")
if not api_key:
    print("Error: OPENAI_API_KEY is not set in environment variables or .env file.")
    print("Please copy .env.example to .env and add your OpenAI API key.")
    sys.exit(1)

# Initialize the OpenAI client
client = OpenAI(api_key=api_key)

def run_agent():
    print("=" * 50)
    print("🤖 Welcome to Ultron AI Agent Starter Kit!")
    print("Type your questions or prompt below.")
    print("Type 'exit', 'quit', or 'q' to end the session.")
    print("=" * 50)

    # Maintain conversation history (system prompt + messages)
    messages = [
        {"role": "system", "content": "You are Ultron, a helpful, concise, and friendly AI assistant."}
    ]

    while True:
        try:
            user_input = input("\nYou: ").strip()
            if user_input.lower() in ["exit", "quit", "q"]:
                print("\nGoodbye! Have a great day.")
                break
            
            if not user_input:
                continue

            # Append user message to history
            messages.append({"role": "user", "content": user_input})

            print("\nUltron is thinking...", end="\r", flush=True)

            # Call OpenAI Chat Completions API
            response = client.chat.completions.create(
                model="gpt-4o-mini",  # You can change to gpt-4o or gpt-3.5-turbo as needed
                messages=messages,
                temperature=0.7,
            )

            assistant_reply = response.choices[0].message.content
            print(" " * 30, end="\r") # Clear thinking indicator
            print(f"Ultron: {assistant_reply}")

            # Append assistant response to history for conversational context
            messages.append({"role": "assistant", "content": assistant_reply})

        except KeyboardInterrupt:
            print("\n\nSession interrupted. Goodbye!")
            break
        except Exception as e:
            print(f"\nAn error occurred: {e}")

if __name__ == "__main__":
    run_agent()
