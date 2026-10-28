# 🌌 ULTRON: The Personal AI Command Center

Ultron is a high-ambition, voice-first desktop AI assistant built for Windows. It is designed to be a "Jarvis-style" operating system for a solo developer's life and business, blending deep OS integration, multimodal awareness, and a cinematic visual interface.

## 🧠 The Brain: Powered by Hermes Agent

Ultron is powered by the **Hermes Agent (Gemma 4)**. Unlike traditional agents that cycle through static API keys, Ultron is integrated directly into the Hermes reasoning runtime, allowing for:
- **Advanced Planning:** Strategic long-term alignment and recursive self-optimization.
- **Multi-Tier Reasoning:** Dynamic switching between **Fast**, **Balanced**, and **Deep** thinking modes based on task complexity.
- **Universal Tool Use:** The ability to orchestrate complex workflows across the OS.

## 🛠️ Core Capabilities

### 🖥️ Full Computer Access
Through `cua-driver`, Ultron possesses "eyes" and "hands" on the Windows desktop:
- **GUI Automation:** Background control of any application via accessibility trees and pixel-perfect visual precision.
- **Autonomous Browsing:** Integration with `browser-use` for multi-step web tasks in isolated environments.
- **OS Awareness:** Real-time monitoring of hardware stats, battery, and active windows.

### 🏛️ The Council of Truth
Ultron doesn't just give one answer. For complex objectives, he invokes the **Council of Truth**—a team of specialized agents (Analytical, Empirical, Historical) who debate the highest truth before reaching a consensus verdict.

### 💾 Infinite Memory
- **Obsidian-Vault Integration:** A durable, semantic memory system that stores life-knowledge in a local vault.
- **Hindsight Memory:** A secondary, long-term memory server for near-instant recall across millions of notes.

### 🥗 Specialized Departments
- **Health & Nutrition:** A universal recognition system that calculates nutrients from recipes and tracks fitness routines.
- **School & Learning:** Deep integration with D2L and academic planning.
- **Project Management:** A hub for business ventures and freelance work.

## 🚀 Quick Start

### Prerequisites
- **Node.js** (v20+)
- **Python 3.11+** (for `pytools` and `cua-driver`)
- **Git**

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Shae1234567/ultron.git
   cd ultron
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Setup environment:
   ```bash
   cp .env.example .env
   # Fill in your API keys (Hermes, etc.)
   ```
4. Launch the development build:
   ```bash
   ./start-ultron.cmd
   ```

## 📜 License
MIT
