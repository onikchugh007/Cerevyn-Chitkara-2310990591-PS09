/**
 * PS09 Invariant Verification Test Suite
 * Specifically tests:
 * 1. Restarting while a mismatch flip-back timer is pending (Ghost flip prevention)
 * 2. 3rd-card lockout rejection during mismatch resolution
 * 3. Restarting while peekAll timer is pending
 * 4. Restarting while final-win transition timer is pending
 * 5. Adaptive difficulty progression honoring adaptation.nextDifficulty as single source of truth
 */

const { generateBoard } = require('../services/seedEngine');
const { SynapseGame } = require('../../public/js/game');

// Lightweight Mock DOM Helper for Node.js test environment
function createMockElement(id = '') {
  const listeners = {};
  const classes = new Set();
  return {
    id,
    dataset: {},
    style: {},
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    classList: {
      add: (cls) => classes.add(cls),
      remove: (cls) => classes.delete(cls),
      contains: (cls) => classes.has(cls),
      toggle: (cls, force) => {
        if (force === undefined) {
          if (classes.has(cls)) { classes.delete(cls); return false; }
          classes.add(cls); return true;
        }
        if (force) { classes.add(cls); return true; }
        classes.delete(cls); return false;
      }
    },
    addEventListener: (evt, fn) => {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    },
    click: function() {
      (listeners['click'] || []).forEach(fn => fn({ target: this }));
    },
    appendChild: () => {},
    removeChild: () => {}
  };
}

describe('PS09 Concurrency, Timer Teardown & Adaptive Invariants', () => {
  let game;
  const elementCache = {};

  beforeEach(async () => {
    jest.useFakeTimers();

    // Set up mock window and document globals
    global.window = {
      addEventListener: jest.fn(),
      synapseAudio: {
        playFlip: jest.fn(),
        playMatch: jest.fn(),
        playMismatch: jest.fn(),
        playReject: jest.fn(),
        playVictory: jest.fn(),
        toggleMute: jest.fn()
      },
      SynapseSeedClient: {
        generateBoard: (seed, diff) => generateBoard(seed, diff)
      }
    };

    global.document = {
      hidden: false,
      addEventListener: jest.fn(),
      getElementById: (id) => {
        if (!elementCache[id]) {
          elementCache[id] = createMockElement(id);
        }
        return elementCache[id];
      },
      createElement: (tag) => createMockElement(tag)
    };

    game = new SynapseGame();
    game.cacheDom();

    // Initialize board with deterministic test seed
    await game.loadNewGame('TEST-RESTART-SEED', 'standard');
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('FLIP A -> FLIP B (MISMATCH) -> RESTART IMMEDIATELY -> ADVANCE TIMERS -> NEW BOARD UNCHANGED', async () => {
    // 1. Find two cards with different pairIds to guarantee mismatch
    const cardAIndex = 0;
    const cardA = game.cards[cardAIndex];
    const cardBIndex = game.cards.findIndex(c => c.pairId !== cardA.pairId);
    expect(cardBIndex).toBeGreaterThan(0);
    const cardB = game.cards[cardBIndex];

    expect(cardA.pairId).not.toBe(cardB.pairId);

    // 2. Flip Card A
    game.handleCardClick(cardAIndex);
    expect(cardA.isFlipped).toBe(true);
    expect(game.flippedCards.length).toBe(1);
    expect(game.isResolvingPair).toBe(false);

    // 3. Flip Card B (Mismatch occurs)
    game.handleCardClick(cardBIndex);
    expect(cardB.isFlipped).toBe(true);
    expect(game.moves).toBe(1);
    expect(game.isResolvingPair).toBe(true); // Concurrency lock engaged!
    expect(game.pendingFlipTimeout).not.toBeNull();

    // 4. Invariant Check: 3rd card selection MUST be rejected during mismatch resolution
    const cardCIndex = game.cards.findIndex((_, idx) => idx !== cardAIndex && idx !== cardBIndex);
    game.handleCardClick(cardCIndex);
    expect(game.cards[cardCIndex].isFlipped).toBe(false);
    expect(game.telemetry.rapidClicksRejected).toBe(1);

    // 5. User immediately hits Restart while mismatch resolution timer is pending
    await game.restart();

    // Verify synchronous state teardown
    expect(game.pendingFlipTimeout).toBeNull();
    expect(game.isResolvingPair).toBe(false);
    expect(game.moves).toBe(0);
    expect(game.pairsMatched).toBe(0);
    expect(game.telemetry.timerResetsHandled).toBe(1);

    // 6. Fast-forward timer past the 900ms mismatch resolution delay & initial preview
    jest.advanceTimersByTime(2500);

    // 7. CRITICAL VERIFICATION: The new board must remain completely clean and reset!
    // Zero cards should be marked mismatch, and moves remain 0
    expect(game.isResolvingPair).toBe(false);
    expect(game.moves).toBe(0);
    game.cards.forEach(card => {
      expect(card.isFlipped).toBe(false);
      expect(card.element.classList.contains('mismatch')).toBe(false);
    });
  });

  test('Restart immediately clears pending peekAll() timer and leaves new board intact', async () => {
    // Start a 3-second peek
    game.peekAll(3000);
    expect(game.peekTimeout).not.toBeNull();

    // Restart while peek is active
    await game.restart();
    expect(game.peekTimeout).toBeNull();

    // Advance fake timer past the 3-second peek duration
    jest.advanceTimersByTime(5000);

    // Cards should not throw errors or be unrevealed by old peek timeout
    expect(game.moves).toBe(0);
    expect(game.isResolvingPair).toBe(false);
  });

  test('Restart immediately clears pending final-win transition timer', async () => {
    // Flip a real matching pair
    const card1 = game.cards[0];
    const card2 = game.cards.find(c => c !== card1 && c.pairId === card1.pairId);

    // Set up so this match completes the board
    game.totalPairs = 1;
    game.handleCardClick(game.cards.indexOf(card1));
    game.handleCardClick(game.cards.indexOf(card2));

    expect(game.pairsMatched).toBe(1);
    expect(game.finalWinTimeout).not.toBeNull();

    // Restart while win countdown is pending
    await game.restart();
    expect(game.finalWinTimeout).toBeNull();

    // Advance timer past the 1400ms win delay
    jest.advanceTimersByTime(3000);

    // Win state should not leak into the new round
    expect(game.isGameWon).toBe(false);
    expect(game.currentLevel).toBe(1);
  });

  test('triggerLevelTransitionAnimation strictly uses adaptation.nextDifficulty as single source of truth', () => {
    // Case A: Demotion returned from backend adaptive engine (Must NOT force Advanced!)
    const demoteAdaptation = {
      action: 'DEMOTE',
      nextDifficulty: 'novice',
      ruleId: 'RULE_DEMOTION_FATIGUE',
      reasonSummary: 'Cognitive fatigue detected'
    };

    game.currentDifficulty = 'standard';
    game.currentLevel = 1;
    game.triggerLevelTransitionAnimation(demoteAdaptation, { actualMoves: 24, elapsedSeconds: 70, efficiency: 33 });

    const titleEl = elementCache['level-transition-title'];
    const subEl = elementCache['level-transition-sub'];

    expect(titleEl.textContent).toContain('RECOVERY MODE');
    expect(subEl.innerHTML).toContain('NPC Tutorial (3×4 Matrix)');

    // Case B: Promotion returned from backend adaptive engine
    const promoteAdaptation = {
      action: 'PROMOTE',
      nextDifficulty: 'advanced',
      ruleId: 'RULE_PROMOTION_OVERCLOCK',
      reasonSummary: 'High performance promotion'
    };

    game.triggerLevelTransitionAnimation(promoteAdaptation, { actualMoves: 10, elapsedSeconds: 22, efficiency: 80 });

    expect(titleEl.textContent).toContain('PROMOTED');
    expect(subEl.innerHTML).toContain('Gigachad Galaxy');
  });
});
