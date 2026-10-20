# Ultron AI Agent Starter Kit

A beginner-friendly starter kit for building your own Python AI agent using the OpenAI API (or compatible LLM providers). 

## Prerequisites

- **Python 3.10+** installed on your system.
- An **OpenAI API Key** (or compatible endpoint API key).

---

## Step-by-Step Installation & Setup

### 1. Clone the Repository
Open your terminal (or command prompt) and run:
```bash
git clone https://github.com/Shae1234567/ultron.git
cd ultron
```

### 2. Create and Activate a Virtual Environment
It is best practice to use a virtual environment to manage your project dependencies:
- **macOS / Linux:**
  ```bash
  python3 -m venv venv
  source venv/bin/activate
  ```
- **Windows (Command Prompt / PowerShell):**
  ```bash
  python -m venv venv
  venv\Scripts\activate
  ```

### 3. Install Dependencies
Install the required Python packages using `pip`:
```bash
pip install -r requirements.txt
```

### 4. Configure Your API Key
Copy the `.env.example` file to create your local `.env` file:
```bash
cp .env.example .env
```
Open `.env` in any text editor and add your actual API key:
```env
OPENAI_API_KEY=your_actual_api_key_here
```

### 5. Run the Agent
Run the main script to start interacting with your AI agent:
```bash
python main.py
```
Type your prompt when prompted and press Enter. Type `exit`, `quit`, or `q` to close the session.
