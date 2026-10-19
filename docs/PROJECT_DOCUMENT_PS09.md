# PS09: Adaptive Memory Matching Game (MEMEMIND)
## Comprehensive Technical Project Specification & Evaluation Report

---

### 🎓 Submission & Candidate Metadata

| Parameter | Official Submission Detail |
| :--- | :--- |
| **Candidate Name** | **Onik Chugh** |
| **University Roll Number** | **2310990591** |
| **Academic Department** | **Computer Science and Engineering (CSE)** |
| **Institution** | **Chitkara University** |
| **Assessment ID** | **Problem Statement 09 (PS09)** |
| **Project Title** | **MEMEMIND: Adaptive Memory Matching Game with Deterministic PRNG Seeds & Cognitive Progression** |
| **GitHub Repository** | [https://github.com/onikchugh007/Cerevyn-Chitkara-210990591-PS09](https://github.com/onikchugh007/Cerevyn-Chitkara-210990591-PS09) |
| **Evaluated Release** | `v1.1.0` (Multi-Device Responsive Release) |
| **CI / CD Pipeline Status** | Passing (GitHub Actions Automated Test & Lint) |

---

## Executive Summary

**MEMEMIND** is a full-stack, responsive cognitive memory matching web application engineered according to the rigorous requirements of **Problem Statement 09 (PS09)**. Unlike conventional, static browser memory games with non-deterministic card distribution and opaque progression, MEMEMIND features:
1. **Deterministic PRNG Seeding**: Reversible, reproducible card distributions powered by a 32-bit Mulberry32 pseudo-random number generator combined with Fisher-Yates array shuffling.
2. **Strict Concurrency Invariants**: Robust state machine guards rejecting third-card selections during mismatch resolution, ignoring duplicate clicks on revealed cards, and eliminating ghost flips upon round reset.
3. **Explainable Cognitive Calibration**: A transparent mathematical rule evaluator calculating player cognitive efficiency:
   $$\text{Cognitive Efficiency (\%)} = \left(\frac{\text{Theoretical Minimum Moves}}{\text{Actual Moves Recorded}}\right) \times 100$$
   Automatically triggering dynamic promotions (to a 6×6, 18-pair matrix) or demotions (to a 3×4, 6-pair matrix) based on moves and search latency thresholds.
4. **Zero-Asset Procedural Audio**: Synthetic, low-latency audio feedback generated dynamically via the native HTML5 Web Audio API without requiring external audio files.
5. **Ergonomic Multi-Device UI**: Viewport-constrained fluid grid architecture with `minmax(0, 1fr)` track sizing, 44px+ touch targets, and mobile landscape gaming adaptations guaranteeing zero horizontal/vertical cutoffs across mobile phones, foldables, tablets, and 4K displays.

---

## 1. System Architecture & Component Design

The application follows a decoupled client-server architecture designed for high throughput, local offline reliability, and cloud deployment on Azure Container Apps.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CLIENT TIER (HTML5 / CSS3 / ES6+)                     │
├───────────────────────────────┬─────────────────────────────────────────────┤
│  Arcade HUD & Navigation      │ Live Scoreboard, Audio Volume, Seed Input   │
│  Interactive 3D Matrix        │ CSS 3D Transforms, Holographic Flip Cards    │
│  State Machine & Controller   │ `game.js`: Concurrency Locks & Timer Engine │
│  Procedural Audio Synthesizer │ `audio.js`: HTML5 Web Audio API Oscillators │
│  Deterministic Board Client   │ `seedClient.js`: Client-Side PRNG Fallback  │
└───────────────────────────────┴─────────────────────────────────────────────┘
                                       │
                         HTTP REST API │ (JSON over Port 3000)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SERVER TIER (Node.js & Express 5)                     │
├───────────────────────────────┬─────────────────────────────────────────────┤
│  `server/server.js`           │ HTTP Entry Point & Graceful SIGTERM Traps   │
│  `server/app.js`              │ Express Middleware Stack (CORS, Static CDN) │
│  `server/routes/api.js`       │ REST Endpoints: `/new`, `/session`, etc.    │
│  `server/services/seedEngine` │ Mulberry32 PRNG & Fisher-Yates Algorithm    │
│  `server/services/adaptive`   │ Explainable Cognitive Progression Engine    │
│  `server/services/session`    │ Ring Buffer & Async Disk Persistence        │
└───────────────────────────────┴─────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PERSISTENCE LAYER (Local JSON / Azure)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  Local Disk DB                │ `server/data/sessions.json` (Latest 200)    │
│  Production Cloud DB          │ Azure Cosmos DB Serverless / Table Storage  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Mathematical Models & Calibration Rules

### 2.1. Deterministic Seeding Engine (Mulberry32 PRNG)
To ensure that entering the same alphanumeric seed string produces an identical board layout:
1. The seed string (e.g., `"DOGE-01"`) is converted into a 32-bit unsigned integer using the Fowler–Noll–Vo (FNV-1a) hash algorithm.
2. The integer seeds the **Mulberry32** generator, delivering statistically uniform pseudo-random values in $[0, 1)$:

```javascript
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

3. The card deck is shuffled using the **Fisher–Yates algorithm**, guaranteeing $O(N)$ unbiased permutation complexity.

### 2.2. Cognitive Progression Rules
Difficulty dynamically adapts across three distinct tiers:

```
       [ Novice: 3×4 (6 Pairs) ]
              ▲          │
              │          │ Moves <= 10 & Time <= 25s
 Moves >= 22  │          ▼
 or Time >=65s│   [ Standard: 4×4 (8 Pairs) ]  <-- Default Starting Mode
              │          ▲          │
              │          │          │ Moves <= 14 & Time <= 35s
              │          │          ▼
              │   [ Advanced: 6×6 (18 Pairs) ]
              └──────────┘
```

- **Promotion Rule (`RULE_PROMOTION_OVERCLOCK`)**:
  - **Threshold**: Moves $\le 14$ ($\text{Efficiency} \ge 57\%$) **AND** Active Time $\le 35\text{s}$.
  - **Action**: Escalates from Standard (4×4) to Advanced (6×6 Matrix with 18 pairs).
  - **Cognitive Rationale**: Demonstrates rapid working-memory encoding and superior spatial recall.
- **Demotion Rule (`RULE_DEMOTION_FATIGUE`)**:
  - **Threshold**: Moves $\ge 22$ ($\text{Efficiency} \le 36\%$) **OR** Active Time $\ge 65\text{s}$.
  - **Action**: Steps down to Novice Tutorial (3×4 Grid with 6 pairs).
  - **Cognitive Rationale**: Detects cognitive fatigue or working-memory overload; reduces cognitive load to establish a baseline.
- **Baseline Retention (`RULE_MAINTAIN_BASELINE`)**:
  - **Threshold**: 15–21 moves and 36–64s elapsed.
  - **Action**: Retains current difficulty level.

---

## 3. Concurrency & State Machine Safety Invariants

```
                      [ Idle / Board Ready ]
                                 │
                         (First Card Click)
                                 ▼
                        [ Card 1 Revealed ]
                                 │
                         (Second Card Click)
                                 ▼
                       [ Move Counted: +1 ]
                                 │
               ┌─────────────────┴─────────────────┐
               ▼                                   ▼
         [ Pair Matches ]                  [ Mismatch Detected ]
               │                                   │
       (Golden Shimmer)                   (Lock 3rd Clicks: isResolving = true)
       (Pairs Matched: +1)                (Play Wah-Wah Sound)
       (Show Match Popup)                 (Start 900ms Tracked Timeout)
               │                                   │
               │                           ┌───────┴───────┐
               │                           ▼               ▼
               │                     (Timeout Ends)   (User Restarts Mid-Timer)
               │                           │               │
               │                     (Flip Back)      (clearTimeout())
               │                     (Unlock Inputs)  (Abort Ghost Flip)
               │                           │               │
               └───────────────────┬───────┘               ▼
                                   │             [ Clean State Reset ]
                                   ▼
                          [ Check Win State ]
                                   │
                  ┌────────────────┴────────────────┐
                  ▼                                 ▼
            (Pairs < Total)                  (Pairs == Total)
                  │                                 │
            [ Keep Playing ]                        ▼
                                            [ Win Celebration ]
                                            [ Submit Telemetry ]
                                            [ Auto-Escalate to Level 2 ]
```

1. **Third-Card Lockout Invariant**: When two non-matching cards are selected, `isResolvingPair = true` immediately blocks all subsequent card click events. Inputs remain strictly locked until the cards flip back after the 900ms delay.
2. **Repeat Click Immunity**: Clicking an already revealed card or an already matched card triggers an early return without penalty or move increments.
3. **Zero Ghost Flips on Restart**: Whenever the player resets the round or switches seeds, pending timeout handles are cleared synchronously (`clearTimeout(this.pendingFlipTimeout)`), preventing late callbacks from flipping cards in the new game session.

---

## 4. Multi-Device Responsive UI/UX Design System

To ensure a comfortable user experience across every device form factor:

| Device Category | Viewport Bounds | Adaptive UI Implementations |
| :--- | :--- | :--- |
| **Compact Phones** | $320\text{px} - 380\text{px}$ (iPhone SE, Fold cover) | Scoreboard shifts to a compact 2×2 grid; card subtitle hidden in 6×6 mode; card gap reduced to 2px. |
| **Standard Smartphones** | $380\text{px} - 580\text{px}$ (iPhone 13–16, Galaxy S24, Pixel) | Full-width 100% scoreboard banner; stacked thumb-friendly control deck; cards constrained with `minmax(0, 1fr)` preventing overflow. |
| **Mobile Landscape Mode** | $\text{Height} \le 520\text{px}$, landscape | Marquee and top nav compressed into a low-profile horizontal bar; match popup switches to horizontal side-by-side photo layout. |
| **Tablets & iPads** | $600\text{px} - 900\text{px}$ | Balanced fluid typography, proportional card gaps, dual-column control deck. |
| **Desktops & 4K Displays** | $960\text{px} - 4\text{K}$ | Centered high-gloss arcade cabinet with atmospheric background aurora and particle sparkles. |

---

## 5. API Data Contracts & Endpoint Specifications

### 5.1. Generate Deterministic Board
- **Method**: `GET /api/game/new`
- **Query Parameters**: `seed` (string), `difficulty` (`novice` | `standard` | `advanced`)
- **Sample Request**: `GET /api/game/new?seed=DOGE-01&difficulty=standard`
- **Sample Response (200 OK)**:
```json
{
  "seed": "DOGE-01",
  "difficulty": "standard",
  "rows": 4,
  "cols": 4,
  "totalCards": 16,
  "totalPairs": 8,
  "cards": [
    { "cardId": "c_0", "pairId": "p_doge", "name": "Doge", "imagePath": "/images/memes/doge.jpg", "color": "#f59e0b" },
    { "cardId": "c_1", "pairId": "p_drake", "name": "Drake Hotline Bling", "imagePath": "/images/memes/drake.jpg", "color": "#00f2fe" }
  ]
}
```

### 5.2. Submit Completed Session & Adaptive Calibration
- **Method**: `POST /api/game/session`
- **Sample Request**:
```json
{
  "seed": "DOGE-01",
  "difficulty": "standard",
  "moves": 12,
  "pairs": 8,
  "elapsedSeconds": 28.5,
  "clientEvents": {
    "rapidClicksRejected": 1,
    "duplicateClicksIgnored": 0
  }
}
```
- **Sample Response (201 Created)**:
```json
{
  "success": true,
  "adaptation": {
    "previousDifficulty": "standard",
    "nextDifficulty": "advanced",
    "action": "PROMOTE",
    "ruleId": "RULE_PROMOTION_OVERCLOCK",
    "reasonSummary": "🏆 GIGACHAD ASCENSION (200 IQ)"
  },
  "metrics": {
    "theoreticalMinMoves": 8,
    "actualMoves": 12,
    "pairs": 8,
    "elapsedSeconds": 28.5,
    "efficiency": 67
  }
}
```

---

## 6. Automated Testing & Verification Suite

All 20 test cases pass cleanly via Jest and Supertest integration:

```
PASS server/tests/api.test.js
  PS09 Memory Game API Integration Tests
    √ GET /api/health returns 200 and healthy status (24 ms)
    √ GET /api/game/new generates a valid default 4x4 board with 8 pairs (18 ms)
    √ GET /api/game/new is deterministic for identical seeds (14 ms)
    √ GET /api/game/new rejects invalid difficulty parameter with 400 (10 ms)
    √ POST /api/game/session records session and returns explainable promotion (26 ms)
    √ POST /api/game/session returns demotion explanation for high moves and latency (15 ms)
    √ POST /api/game/session rejects requests missing required metrics with 400 (9 ms)
    √ GET /api/game/analytics returns aggregate telemetry and session history (12 ms)
    √ GET /api/game/rules returns documented adaptation matrix schema (8 ms)

PASS server/tests/adaptiveEngine.test.js
  AdaptiveEngine - Cognitive Metrics & Explainable Rules
    √ calculateMetrics accurately computes cognitive efficiency and ratios (4 ms)
    √ evaluateSession promotes Standard to Advanced under high performance threshold (3 ms)
    √ evaluateSession demotes Standard to Novice under cognitive fatigue threshold (2 ms)
    √ evaluateSession maintains Standard within baseline moves and time window (2 ms)
    √ evaluateSession promotes Novice to Standard when tutorial thresholds are met (2 ms)
    √ evaluateSession steps down Advanced to Standard under high matrix fatigue (2 ms)

PASS server/tests/seedEngine.test.js
  SeedEngine - PRNG Determinism & Board Generation
    √ Mulberry32 PRNG produces identical sequence for identical seeds (3 ms)
    √ Mulberry32 PRNG produces different sequences for different seeds (2 ms)
    √ generateBoard generates exactly 8 unique pairs (16 cards) for standard difficulty (4 ms)
    √ generateBoard generates 6 pairs for novice and 18 pairs for advanced (5 ms)
    √ generateBoard assigns valid pairIds and identical meme images for pairs (3 ms)

Test Suites: 3 passed, 3 total
Tests:       20 passed, 20 total
Snapshots:   0 total
Time:        1.902 s
```

---

## 7. Cloud Deployment & Hosting Architecture (Azure)

- **Compute**: Azure Container Apps (ACA) with serverless scale-to-zero when idle, running the production multi-stage Docker container.
- **Storage**: Azure Cosmos DB Serverless / Azure Table Storage for aggregate telemetry records.
- **Security**: Zero static credentials; GitHub Actions authenticates against Azure via OpenID Connect (OIDC) federated credentials.
- **Cost Efficiency**: Operates within free-tier and serverless consumption budgets.

---

## 8. Evaluator Verification Walkthrough (3-Minute Guide)

1. **Step 1: Test Deterministic Reproducibility**
   - Type `DOGE-01` into the Seed box and press Enter.
   - Note the position of the first card (e.g., Doge at top-left).
   - Press the **🔴 Home** button: the board regenerates with identical card positions.
2. **Step 2: Test Concurrency Lock**
   - Click two non-matching cards.
   - Rapidly click a third card during the 900ms mismatch flip-back window.
   - The third click is rejected with a bonk sound; no extra move is counted.
3. **Step 3: Test Zero Ghost Flips on Restart**
   - Flip one card, flip a mismatch, and instantly click **🔴 Home**.
   - The pending flip-back timer is cancelled cleanly without phantom flips in the next round.
4. **Step 4: Test Level Escalation**
   - Complete Level 1 (8 pairs): a cinematic level-cleared modal counts down from 3s and smoothly escalates into Level 2 (6×6 Matrix, 18 pairs).
5. **Step 5: Test Multi-Device Responsiveness**
   - Open Developer Tools, toggle device emulation, and test on iPhone (390px), iPad (768px), and mobile landscape. All cards fit neatly inside the cabinet with zero clipping.

---

## 9. Academic Integrity & AI Assistance Statement

- **Candidate's Original Contributions**:
  - Architectural design, backend Express routing, Mulberry32 PRNG integration, concurrency lock state machine, adaptive cognitive threshold formulas, Web Audio procedural sound synthesizer, multi-device CSS Grid responsive system, and full automated Jest test suites.
- **Third-Party / Open-Source Assets**:
  - 22 public domain internet meme photographs stored locally in `public/images/memes/`.
  - Open-source Google Fonts (Outfit, JetBrains Mono).
- **AI Tool Usage**:
  - Antigravity AI was utilized for code auditing, CSS layout refinement, and test scaffolding. All final code and architectural designs were verified and validated by the candidate.

---
*Report Prepared by: Onik Chugh (Roll No: 2310990591, Chitkara University) • Problem Statement PS09*
