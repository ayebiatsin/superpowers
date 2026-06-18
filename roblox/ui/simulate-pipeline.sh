#!/usr/bin/env bash
# Simulate a full agent pipeline run to demo the dashboard.
# Creates handoff files one by one with pauses so you can watch
# the dashboard phases update in real time.
#
# Usage: simulate-pipeline.sh [--project-dir <path>] [--fast]
#   --project-dir <path>  Directory to write files into (default: current dir)
#   --fast                No pauses between steps (for automated testing)

PROJECT_DIR="$(pwd -P)"
FAST="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) PROJECT_DIR="$(cd "$2" && pwd)"; shift 2 ;;
    --fast) FAST="true"; shift ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

pause() {
  if [[ "$FAST" != "true" ]]; then
    echo "  (waiting ${1}s — check the dashboard now)"
    sleep "$1"
  fi
}

step() { echo; echo "▶ $1"; }

cleanup() {
  rm -f \
    "$PROJECT_DIR/feature-spec.md" \
    "$PROJECT_DIR/build-complete.md" \
    "$PROJECT_DIR/qa-report.md" \
    "$PROJECT_DIR/devex-report.md" \
    "$PROJECT_DIR/spec-question.md" \
    "$PROJECT_DIR/systems.md"
}

echo "Game Studio Pipeline Simulation"
echo "Project dir: $PROJECT_DIR"
echo "Open the dashboard in your browser, then press Enter to start."
[[ "$FAST" != "true" ]] && read -r

# ── Clean start ────────────────────────────────────────────────────────────
cleanup

# ── Phase: Design ──────────────────────────────────────────────────────────
step "Phase 1 — Design agent writes systems.md"
cat > "$PROJECT_DIR/systems.md" << 'EOF'
# Game Systems Document
Version: 1.0

## Core Loop
Kill enemies → gain XP → level up → unlock skills → tackle harder enemies

## XP Parameters
- XP per kill: 50
- XP per difficulty tier multiplier: +10%
- Level 1 → 2 threshold: 500 XP
- Level cap: 50

## Economy
- Gold per kill: 10
- Gold per chest: 50–200
- Shop refresh: every 5 minutes
EOF
echo "  ✓ systems.md written"
pause 4

step "Phase 1 — Design agent writes feature-spec.md (Talent Tree)"
cat > "$PROJECT_DIR/feature-spec.md" << 'EOF'
# Feature Spec: Talent Tree
Version: 1.0

## Mechanic description
Players unlock a talent tree at level 5. Each level grants one talent point
to spend on passive bonuses in three branches: Warrior, Mage, Rogue.

## Required Roblox objects / APIs
- DataStoreService: persist talent allocations per player
- ReplicatedStorage.Remotes.TalentTree_Spend remote event
- ReplicatedStorage.Modules.TalentManager module
- ServerScriptService.Systems.TalentSystem server script

## Data model
| Field          | Type    | Scope  | Notes                        |
|----------------|---------|--------|------------------------------|
| TalentPoints   | number  | Server | Granted on level-up          |
| Allocations    | table   | Server | {branchName: pointsSpent}    |
| UnlockLevel    | number  | Const  | 5 — hard-coded at spec time  |

## Parameters
- Talent points per level: 1
- Max points per branch: 10
- Warrior branch bonus per point: +5% max HP
- Mage branch bonus per point: +8% spell damage
- Rogue branch bonus per point: +6% crit chance

## Acceptance criteria
1. Talent UI appears at level 5 and not before
2. Spending a talent point persists across server restarts (DataStore)
3. Warrior branch: 10 points = +50% max HP
4. Mage branch: 10 points = +80% spell damage
5. Rogue branch: 10 points = +60% crit chance
6. Cannot exceed 20 total talent points at level 20
EOF
echo "  ✓ feature-spec.md written — dashboard should show BUILD phase"
pause 6

# ── Phase: Build ───────────────────────────────────────────────────────────
step "Phase 2 — Build agent writes build-complete.md"
cat > "$PROJECT_DIR/build-complete.md" << 'EOF'
# Build Complete: Talent Tree
Spec version: 1.0

## What was built
- ReplicatedStorage/Modules/TalentManager.lua: Core talent logic (spend, refund, query)
- ServerScriptService/Systems/TalentSystem.lua: Server-side handler, DataStore persistence
- StarterPlayerScripts/Client/TalentUI.lua: Tree UI, opens at level 5

## How to trigger in playtest
1. Start Play Solo
2. Use the debug console: `game.Players.LocalPlayer.leaderstats.Level.Value = 5`
3. Press T to open the talent tree
4. Click a branch node to spend a point
5. Rejoin — verify point allocation persists

## Known limitations
- Refund mechanic is not in this spec; points are permanent
- UI does not animate unlocks (deferred to polish pass)

## Numbers to verify
| Parameter | Spec value | Implemented |
|-----------|-----------|-------------|
| Talent points per level | 1 | 1 |
| Unlock level | 5 | 5 |
| Warrior HP bonus/point | +5% | +5% |
| Mage damage bonus/point | +8% | +8% |
| Rogue crit bonus/point | +6% | +6% |
| Max points per branch | 10 | 10 |
EOF
echo "  ✓ build-complete.md written — dashboard should show QA phase"
pause 6

# ── Phase: QA — first pass with Critical finding ────────────────────────────
step "Phase 3 — QA agent finds a Critical issue (XP scaling broken)"
cat > "$PROJECT_DIR/qa-report.md" << 'EOF'
# QA Report: Talent Tree
Spec version: 1.0

## Acceptance criteria
| Criterion                              | Result | Observed           | Expected    |
|----------------------------------------|--------|--------------------|-------------|
| Talent UI appears at level 5           | PASS   | Opens at level 5   | Level 5     |
| Points persist across restarts         | PASS   | Confirmed          | Persist     |
| Warrior 10pts = +50% HP                | FAIL   | +500% HP           | +50% HP     |
| Mage 10pts = +80% spell damage         | PASS   | +80%               | +80%        |
| Rogue 10pts = +60% crit chance         | PASS   | +60%               | +60%        |
| Cannot exceed 20 pts at level 20       | PASS   | Capped at 20       | 20 max      |

## Balance findings

**1. Warrior HP bonus stacking**
- Severity: Critical
- Observed: +500% max HP at 10 points (50% applied per talent point, not total)
- Expected range: +50% max HP total at 10 points
- Evidence: Level 5 Warrior playtest, 10-point investment → 6× base HP, one-shots all enemies

## Recommendations for Design agent
- Warrior branch: change bonus from "per point" to "cumulative total" — implementation bug, not a design change
  Spec says "+5% max HP per point" but should read "allocations * 5% total cap at 50%"
  Clarify the spec wording to prevent recurrence

## Items requiring immediate attention
**1. Warrior HP bonus stacking** — Severity: Critical — player is unkillable at 10 Warrior points
EOF
echo "  ✓ qa-report.md written (Critical) — dashboard should show BALANCE LOOP phase"
pause 8

# ── Phase: Balance loop — Design + Build fix ───────────────────────────────
step "Phase 4 — Design agent updates spec, Build agent fixes implementation"
cat > "$PROJECT_DIR/feature-spec.md" << 'EOF'
# Feature Spec: Talent Tree
Version: 1.1 — patch: Warrior HP formula corrected

## Parameters
- Talent points per level: 1
- Max points per branch: 10
- Warrior branch bonus: allocations × 5% (total, not stacked per tick) — max +50% at 10 pts
- Mage branch bonus per point: +8% spell damage
- Rogue branch bonus per point: +6% crit chance

## Acceptance criteria
1. Talent UI appears at level 5 and not before
2. Spending a talent point persists across server restarts
3. Warrior branch: 10 points = exactly +50% max HP (not +500%)
4. Mage branch: 10 points = +80% spell damage
5. Rogue branch: 10 points = +60% crit chance
6. Cannot exceed 20 total talent points at level 20
EOF

cat > "$PROJECT_DIR/build-complete.md" << 'EOF'
# Build Complete: Talent Tree
Spec version: 1.1

## What changed
- TalentManager.lua: Warrior HP calculation changed from `points * 0.05` per tick
  to `totalAllocated * 0.05` applied once on equip. Root cause was operator
  precedence bug in the original formula.

## How to trigger in playtest
Same as v1.0 — invest 10 points in Warrior, verify HP increases by exactly 50%.

## Numbers to verify
| Parameter | Spec value | Implemented |
|-----------|-----------|-------------|
| Warrior HP bonus total at 10pts | +50% | +50% |
EOF
echo "  ✓ spec v1.1 + build v1.1 written — dashboard back to QA phase"
pause 6

# ── Phase: QA — second pass, all clear ────────────────────────────────────
step "Phase 5 — QA re-validates, all gates pass"
cat > "$PROJECT_DIR/qa-report.md" << 'EOF'
# QA Report: Talent Tree (re-validation)
Spec version: 1.1

## Acceptance criteria
| Criterion                              | Result | Observed           | Expected    |
|----------------------------------------|--------|--------------------|-------------|
| Talent UI appears at level 5           | PASS   | Opens at level 5   | Level 5     |
| Points persist across restarts         | PASS   | Confirmed          | Persist     |
| Warrior 10pts = +50% HP                | PASS   | +50% HP            | +50% HP     |
| Mage 10pts = +80% spell damage         | PASS   | +80%               | +80%        |
| Rogue 10pts = +60% crit chance         | PASS   | +60%               | +60%        |
| Cannot exceed 20 pts at level 20       | PASS   | Capped at 20       | 20 max      |

## Balance findings

**1. Rogue crit feel**
- Severity: Minor
- Observed: Crit visual flash is subtle at max crit chance
- Expected range: Noticeable but not disruptive
- Evidence: Preference, not a balance issue

## Recommendations for Design agent
- Consider a crit sound effect in a future polish pass (Minor — not blocking)

## Items requiring immediate attention
None.
EOF
echo "  ✓ qa-report.md (all PASS, Minor only) — dashboard should show READY phase"
pause 5

# ── Phase: Monetization (async) ────────────────────────────────────────────
step "Phase 6 — Monetization agent sends devex-report.md (async)"
cat > "$PROJECT_DIR/devex-report.md" << 'EOF'
# DevEx Report
Date: 2026-06-18

## Health summary
| Metric             | Value | Status  |
|--------------------|-------|---------|
| D1 retention       | 44%   | Healthy |
| D7 retention       | 18%   | Healthy |
| Conversion rate    | 1.2%  | Healthy |
| Revenue concentration | Starter Pack 38% | Healthy |

## Conversion analysis
| Pass             | Price  | Purchase rate | Revenue share | Diagnosis         |
|------------------|--------|---------------|---------------|-------------------|
| Starter Pack     | 99 R$  | 0.9%          | 38%           | Performing well   |
| XP Boost         | 299 R$ | 0.3%          | 22%           | Low — see below   |
| Warrior Bundle   | 799 R$ | 0.1%          | 28%           | Superfan tier OK  |
| Season Pass      | 1499 R$| 0.04%         | 12%           | Expected low      |

## Pricing ladder assessment
Current ladder is healthy. XP Boost at 299 R$ has low conversion — players may
not understand what it unlocks. Recommend adding "2× XP for 1 hour" to the
pass description (clarify it's temporary, not permanent — reduces pay-to-win risk).

## Recommendations
- XP Boost: update description to specify duration and scope. No price change yet.
- Consider a cosmetic-only 149 R$ pass (outfit or pet) to capture mid casual tier.

## Flags for Design agent
- D7 retention at 18% is healthy but watch it after the talent tree ships.
  If it dips below 15%, add a week-3 progression unlock to re-hook returning players.
- No pay-to-win flags detected.
EOF
echo "  ✓ devex-report.md written — dashboard shows monetization data"
pause 4

echo
echo "Simulation complete. All 5 pipeline phases demonstrated."
echo "Handoff files remain in: $PROJECT_DIR"
echo "Run with --fast to skip pauses."
