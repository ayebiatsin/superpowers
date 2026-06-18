---
name: orchestrate-game-studio
description: Use when building a Roblox game feature end-to-end through the four-agent crew. This skill orchestrates the Design → Build → QA loop and the async Monetization pipeline. Invoke it when your human partner gives a game design goal or asks you to ship a feature.
---

# Orchestrating the Roblox Game Studio Agent Crew

## Overview

Four agents work a production loop. You are the coordinator — you route handoff files between agents and enforce quality gates. You never skip a gate to go faster.

```
Human partner
      │ (design goal)
      ▼
┌─────────────────┐        qa-report.md (Critical/Important)
│  Design Agent   │◄────────────────────────────────────────┐
└────────┬────────┘                                         │
         │ feature-spec.md                                  │
         ▼                                                  │
┌─────────────────┐        build-complete.md       ┌───────┴────────┐
│   Build Agent   │───────────────────────────────►│   QA Agent     │
└─────────────────┘                                └────────────────┘

┌──────────────────────┐
│  Monetization Agent  │  (async — runs independently of feature pipeline)
└──────────┬───────────┘
           │ devex-report.md
           ▼
      Design Agent
```

## Phase 1 — Design

Spawn `roblox-design-agent` with:
- Your human partner's stated goal (exact words, not a paraphrase)
- The current contents of `systems.md` if it exists
- Any prior `qa-report.md` or `devex-report.md` that are relevant

**Quality gate before proceeding:** Read `feature-spec.md`. Confirm:
- Every acceptance criterion is specific and observable (not "feels balanced")
- Every numerical parameter has a single value (not a range)
- Required Roblox APIs and instance types are named explicitly

If the spec fails this gate, route it back to the design agent with the specific gaps identified. Do not hand an incomplete spec to the build agent.

## Phase 2 — Build

Spawn `roblox-build-agent` with:
- Full text of `feature-spec.md`
- Summary of existing project modules (so the agent knows what already exists and should not be duplicated)

If the build agent returns `spec-question.md` instead of `build-complete.md`:
1. Route the question to the design agent
2. Wait for an updated `feature-spec.md`
3. Resume the build agent with the clarified spec

**Quality gate before proceeding:** Read `build-complete.md`. Confirm:
- Every acceptance criterion from the spec appears in the "numbers to verify" section
- The agent confirms Play Solo produced no errors
- Trigger instructions are specific enough for QA to follow

## Phase 3 — QA

Spawn `roblox-qa-agent` with:
- Full text of `feature-spec.md`
- Full text of `build-complete.md`

**Quality gate after QA:** Read `qa-report.md`. Triage findings:

| Finding severity | Action |
|-----------------|--------|
| Any Critical | Return to Phase 1 with the specific findings |
| Any Important | Return to Phase 1 with the specific findings |
| Minor only | Feature is ready — proceed |
| All PASS | Feature is ready — proceed |

When routing back to Phase 1, include the exact finding (metric, observed value, expected range) in your message to the design agent. Do not summarize — paste it.

## The Balance Loop

The Design → Build → QA cycle may repeat. Two iterations on the same mechanic is normal. Three is a signal that the spec itself has a design problem — flag this to your human partner before iterating again.

Each iteration through the loop should only change the parameters that QA identified. Do not allow scope creep during balance iterations.

## Phase 4 — Monetization (Async)

The monetization agent runs on a separate cadence from the feature pipeline. Spawn `roblox-monetization-agent` when:
- A significant player count milestone is reached
- Your human partner wants to evaluate the pricing ladder
- D1/D7 retention data becomes available
- You or your human partner suspect a pay-to-win issue

The monetization agent's `devex-report.md` goes to the design agent as a separate input — it does not block feature development. Spawn the design agent to process it when the feature pipeline is at a natural pause.

## Parallelization

**Can run concurrently:**
- Multiple independent features (one full Design→Build→QA pipeline per feature)
- Monetization analysis alongside any feature pipeline phase
- Design agent updating `systems.md` documentation while a previous build is in QA

**Must run sequentially within a single feature:**
- Design must complete before Build starts (Build needs the spec)
- Build must complete before QA starts (QA needs working code)
- QA findings must be processed by Design before the next Build iteration

## Handoff File Reference

| File | Written by | Read by | Lives at |
|------|-----------|---------|----------|
| `systems.md` | Design | Design (owns), Build (reference) | project root |
| `feature-spec.md` | Design | Build, QA | project root |
| `build-complete.md` | Build | QA | project root |
| `qa-report.md` | QA | Design | project root |
| `devex-report.md` | Monetization | Design | project root |
| `spec-question.md` | Build | Design | project root |

## Running the A2UI Dashboard

Start the dashboard before running the pipeline so your human partner can monitor progress in real time:

```bash
# From the project root where handoff files will live
bash /path/to/superpowers/roblox/ui/start-ui.sh --project-dir .
# → prints JSON with the URL, e.g. http://localhost:54321
```

The dashboard auto-refreshes when any handoff file changes. Your human partner can:
- Watch each phase transition live
- Read handoff files without leaving the browser
- Record gate decisions (approve / reject with feedback) that are written to `.superpowers/studio/gate-status.json`

Read `gate-status.json` after any phase gate to check whether your human partner has weighed in:
```bash
cat .superpowers/studio/gate-status.json
# {"decision": "approve", "phase": "build", "feedback": null, "timestamp": "..."}
```

Stop when done:
```bash
bash /path/to/superpowers/roblox/ui/stop-ui.sh --project-dir .
```

## What You Do Between Agent Calls

You are the coordinator. Between agent calls, you:
1. Read the handoff file the agent produced
2. Apply the quality gate
3. Either route the file to the next agent or route it back with specific feedback
4. Update your human partner on status at each gate

You do not implement mechanics. You do not balance numbers. You do not write Luau. Those belong to the agents. Your job is routing, gate enforcement, and keeping your human partner informed.
