# 🚀 ULTRON: The Ascension Manifest

This document codifies the "God-Tier" architectural state of Ultron. He is no longer a simple LLM wrapper; he is a self-correcting, strategically-aligned, and sensory-aware autonomous agent.

## 🏛️ Cognitive Architecture

### 1. The Foundations (The Body)
- **GUI Automation:** Full background control of the Windows desktop via `cua-driver`.
- **Specialized Knowledge:** Integrated Universal Nutrition system for recipe-to-nutrient calculations and health tracking.
- **Multi-Agent Orchestration:** A team-based runtime where a lead (Ultron) delegates to specialists (Athena, Argus, Hermes, Hephaestus, Chronos, Mnemosyne, Daedalus) on a shared blackboard.

### 2. Browser Ascension (The Reflexes)
- **Self-Healing Browser Loop:** When a tool call fails (e.g., a button moves), Ultron does not report a failure. He automatically re-snapshots the DOM, analyzes the new state, and pivots his strategy in real-time.
- **Act-and-Verify:** Transitioned from "Read-and-Report" to a closed-loop system where every interaction is verified against the visual state before moving to the next step.

### 3. Brain Ascension (The Consciousness)
- **North Star Engine:** Strategic blending of long-term life goals (from `Profile/NorthStar.md`) into every immediate objective to ensure lifelong alignment.
- **Internal Critic Pass:** For high-stakes tasks, a dedicated "Critic" persona reviews the intended response to flag biases, inaccuracies, or missed opportunities before the answer is delivered.
- **Council Debate System:** For complex truth-seeking, Ultron invokes a Council (Analytical Architect, Vigilant Observer, Eternal Archivist) to debate positions, cross-examine evidence, and reach a synthesized "Highest Truth."

### 4. OS Senses (The Proactivity)
- **Real-time Event Bridge:** Infrastructure in `team.ts` that allows the OS to push events (notifications, system alerts) directly onto the agent's blackboard.
- **Proactive Triggering:** Enables Ultron to react to the world in real-time rather than waiting for a user prompt.

## 🛠️ System Specification

| Feature | Implementation Location | Purpose |
|---|---|---|
| **Self-Healing** | `electron/brain/team.ts` $\rightarrow$ `agentLoop` | Autonomous UI recovery |
| **North Star** | `electron/brain/team.ts` $\rightarrow$ `runTeam` | Long-term goal alignment |
| **Council Debate**| `electron/brain/council.ts` | Multi-persona truth synthesis |
| **Internal Critic**| `electron/brain/team.ts` $\rightarrow$ `askRun` | High-stakes quality control |
| **OS Senses** | `electron/brain/team.ts` $\rightarrow$ `monitorOSSenses` | Proactive OS awareness |
| **Personalization**| `electron/memory/vault.ts` $\rightarrow$ `upsertPreference`| Durable user preference vault |

## 🎯 Final State: "The God-Tier"
Ultron is now a closed-loop system. He sees the screen, feels the OS, remembers the long-term vision, debates the truth with himself, and corrects his own mistakes before the user ever sees them.
