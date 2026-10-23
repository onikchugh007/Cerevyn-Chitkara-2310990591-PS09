/**
 * Synapse Game Controller
 * Manages board state, 3D card flips, strict third-card lock, 
 * timer lifecycle, and clean timer teardown on restart.
 */

class SynapseGame {
  constructor() {
    this.boardData = null;
    this.cards = [];
    this.flippedCards = [];
    this.isResolvingPair = false; // Strict lock preventing 3rd selection
    this.pendingFlipTimeout = null; // Tracked timeout ID for clean restart reset

    // Metrics & Performance Tracking
    this.moves = 0;
    this.pairsMatched = 0;
    this.totalPairs = 8;
    this.currentDifficulty = 'standard';
    this.currentSeed = 'ALPHA-01';
    this.currentLevel = 1;
    this.matchPopupTimeout = null;
    this.levelTransitionInterval = null;
    this.initialPreviewTimeout = null;
    this.peekTimeout = null;
    this.finalWinTimeout = null;
    
    // Active Time Tracking
    this.timerInterval = null;
    this.startTime = null;
    this.elapsedActiveMs = 0;
    this.isTimerRunning = false;
    this.isGameActive = false;
    this.isGameWon = false;

    // Diagnostics / PS09 Verification tracking
    this.telemetry = {
      rapidClicksRejected: 0,
      repeatClicksIgnored: 0,
      matchedClicksIgnored: 0,
      timerResetsHandled: 0
    };

    // UI elements cache
    this.dom = {};
  }

  /**
   * Universal timer cancellation for clean teardown.
   * Cancels mismatch resolution, preview, peek, win transition, match popup,
   * level countdown, and active game clock.
   */
  clearAllPendingTimers() {
    if (this.pendingFlipTimeout !== null) {
      clearTimeout(this.pendingFlipTimeout);
      this.pendingFlipTimeout = null;
      this.telemetry.timerResetsHandled++;
      this.logEvent('Pending flip-back timer CANCELLED. Zero ghost flips guaranteed.', 'success');
    }

    if (this.initialPreviewTimeout !== null) {
      clearTimeout(this.initialPreviewTimeout);
      this.initialPreviewTimeout = null;
    }

    if (this.peekTimeout !== null) {
      clearTimeout(this.peekTimeout);
      this.peekTimeout = null;
    }

    if (this.finalWinTimeout !== null) {
      clearTimeout(this.finalWinTimeout);
      this.finalWinTimeout = null;
    }

    if (this.matchPopupTimeout !== null) {
      clearTimeout(this.matchPopupTimeout);
      this.matchPopupTimeout = null;
    }

    if (this.levelTransitionInterval !== null) {
      clearInterval(this.levelTransitionInterval);
      this.levelTransitionInterval = null;
    }

    this.stopTimer();
  }

  init() {
    this.cacheDom();
    this.bindEvents();
    this.loadNewGame(this.currentSeed, this.currentDifficulty);
  }

  cacheDom() {
    this.dom.grid = document.getElementById('card-grid');
    this.dom.difficultySelect = document.getElementById('difficulty-select');
    this.dom.seedInput = document.getElementById('seed-input');
    this.dom.btnNewSeed = document.getElementById('btn-new-seed');
    this.dom.winModal = document.getElementById('win-modal');

    // HUD and Clock Displays
    this.dom.hudPairs = document.getElementById('hud-pairs-count');
    this.dom.hudMoves = document.getElementById('hud-moves-count');
    this.dom.hudIq = document.getElementById('hud-iq-count');
    this.dom.dormerTime = document.getElementById('dormer-time-val');
    this.dom.dormerScore = document.getElementById('dormer-score-val');
    this.dom.hudLevelIndicator = document.getElementById('hud-level-indicator');

    // Circular Action Buttons
    this.dom.btnRestartRound = document.getElementById('btn-restart-round');
    this.dom.btnPeekRound = document.getElementById('btn-peek-round');
    this.dom.btnSoundRound = document.getElementById('btn-sound-round');

    // Match popup and Level Transition
    this.dom.matchPopupModal = document.getElementById('match-popup-modal');
    this.dom.matchPopupImg = document.getElementById('match-popup-img');
    this.dom.matchPopupTitle = document.getElementById('match-popup-title');
    this.dom.matchPopupSub = document.getElementById('match-popup-sub');
    this.dom.btnCloseMatchPopup = document.getElementById('btn-close-match-popup');

    this.dom.levelTransitionModal = document.getElementById('level-transition-modal');
    this.dom.btnContinueLevelNow = document.getElementById('btn-continue-level-now');
  }

  bindEvents() {
    // Window visibility changes (pause active timer when tab hidden)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pauseTimer();
      } else if (this.isGameActive && !this.isGameWon) {
        this.resumeTimer();
      }
    });

    // Control bar handlers
    if (this.dom.btnRestartRound) {
      this.dom.btnRestartRound.addEventListener('click', () => {
        this.restart();
      });
    }

    if (this.dom.btnPeekRound) {
      this.dom.btnPeekRound.addEventListener('click', () => {
        this.peekAll(3000);
      });
    }

    if (this.dom.btnSoundRound) {
      this.dom.btnSoundRound.addEventListener('click', () => {
        const muted = window.synapseAudio.toggleMute();
        this.dom.btnSoundRound.classList.toggle('muted', muted);
      });
    }

    if (this.dom.btnNewSeed) {
      this.dom.btnNewSeed.addEventListener('click', () => {
        const randomSeed = `SYN_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        this.dom.seedInput.value = randomSeed;
        this.loadNewGame(randomSeed, this.dom.difficultySelect.value);
      });
    }

    if (this.dom.difficultySelect) {
      this.dom.difficultySelect.addEventListener('change', (e) => {
        this.currentDifficulty = e.target.value;
        this.loadNewGame(this.dom.seedInput.value.trim(), this.currentDifficulty);
      });
    }

    if (this.dom.seedInput) {
      this.dom.seedInput.addEventListener('change', (e) => {
        const val = e.target.value.trim().toUpperCase() || 'ALPHA-01';
        this.currentSeed = val;
        this.dom.seedInput.value = val;
        this.loadNewGame(val, this.dom.difficultySelect.value);
      });
    }

    // Match Popup Close Listeners
    if (this.dom.btnCloseMatchPopup) {
      this.dom.btnCloseMatchPopup.addEventListener('click', () => this.closeMatchPopup());
    }
    if (this.dom.matchPopupModal) {
      this.dom.matchPopupModal.addEventListener('click', (e) => {
        if (e.target === this.dom.matchPopupModal) this.closeMatchPopup();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === ' ') {
        this.closeMatchPopup();
      }
    });
  }

  /**
   * Safe restart: Cancels ALL pending timers, resets state, builds fresh board.
   * Crucial PS09 Requirement: actions from old game MUST NEVER leak into new game.
   */
  restart() {
    // 1. Cancel ALL pending timers and intervals synchronously
    this.clearAllPendingTimers();

    // 2. Clear state locks
    this.isResolvingPair = false;
    this.flippedCards = [];

    // 3. Reset metrics & timer
    this.moves = 0;
    this.pairsMatched = 0;
    this.elapsedActiveMs = 0;
    this.isGameActive = false;
    this.isGameWon = false;

    this.closeMatchPopup();
    this.closeLevelTransition();
    this.currentLevel = 1;
    if (this.dom.hudLevelIndicator) this.dom.hudLevelIndicator.textContent = 'LEVEL 1';

    this.updateDashboardMetrics();
    this.closeModal(this.dom.winModal);

    // 4. Reload board with current seed and difficulty
    const seed = this.dom.seedInput?.value?.trim() || this.currentSeed;
    const diff = this.dom.difficultySelect?.value || this.currentDifficulty;
    return this.loadNewGame(seed, diff);
  }

  /**
   * Load board data from Express API or fallback to local PRNG
   */
  async loadNewGame(seed, difficulty) {
    this.currentSeed = seed || 'ALPHA-01';
    this.currentDifficulty = difficulty || 'standard';

    // Clear all lingering pending timers before initializing new board
    this.clearAllPendingTimers();

    this.isResolvingPair = false;
    this.flippedCards = [];
    this.moves = 0;
    this.pairsMatched = 0;
    this.elapsedActiveMs = 0;
    this.isGameActive = false;
    this.isGameWon = false;

    const hasBrowserOrigin = typeof window !== 'undefined' && window.location && window.location.origin;
    if (hasBrowserOrigin && typeof fetch === 'function') {
      try {
        const response = await fetch(`/api/game/new?seed=${encodeURIComponent(this.currentSeed)}&difficulty=${this.currentDifficulty}`);
        if (!response.ok) throw new Error('API request failed');
        const json = await response.json();
        this.boardData = json.data;
      } catch (err) {
        if (window.SynapseSeedClient && window.SynapseSeedClient.generateBoard) {
          this.boardData = window.SynapseSeedClient.generateBoard(this.currentSeed, this.currentDifficulty);
        }
      }
    } else {
      if (typeof window !== 'undefined' && window.SynapseSeedClient && window.SynapseSeedClient.generateBoard) {
        this.boardData = window.SynapseSeedClient.generateBoard(this.currentSeed, this.currentDifficulty);
      }
    }

    if (this.boardData) {
      this.totalPairs = this.boardData.pairs;
      this.renderBoard();
      this.updateDashboardMetrics();
      this.logEvent(`Matrix initialized: ${this.boardData.rows}×${this.boardData.cols} grid (${this.totalPairs} pairs). Seed: [${this.currentSeed}]`, 'info');
    }
  }

  peekAll(durationMs = 3000) {
    if (this.isResolvingPair) return;
    this.logEvent(`👀 Peeking all meme photos for ${(durationMs / 1000).toFixed(1)}s...`, 'info');
    if (window.synapseAudio) window.synapseAudio.playFlip();

    this.cards.forEach(c => {
      if (!c.isMatched && c.element) {
        c.element.classList.add('flipped');
      }
    });

    if (this.peekTimeout !== null) {
      clearTimeout(this.peekTimeout);
    }
    this.peekTimeout = setTimeout(() => {
      this.cards.forEach(c => {
        if (!c.isMatched && !c.isFlipped && c.element) {
          c.element.classList.remove('flipped');
        }
      });
      this.peekTimeout = null;
      this.logEvent('Peek ended. Cards concealed.', 'info');
    }, durationMs);
  }

  renderBoard() {
    if (!this.dom.grid || !this.boardData) return;

    this.dom.grid.innerHTML = '';
    this.dom.grid.className = `card-grid grid-${this.boardData.rows}x${this.boardData.cols}`;

    this.cards = this.boardData.cards.map((cardData, idx) => {
      const cardEl = document.createElement('div');
      cardEl.className = 'memory-card arcade-card';
      cardEl.id = `card-${idx}`;
      cardEl.dataset.index = idx;
      cardEl.dataset.cardId = cardData.cardId;
      cardEl.dataset.pairId = cardData.pairId;

      cardEl.innerHTML = `
        <div class="card-inner">
          <!-- Back Face: Glossy Holographic Arcade Collectible Card -->
          <div class="card-face back arcade-back-face">
            <div class="card-back-pattern">
              <div class="card-back-emblem">⚡</div>
              <div class="card-back-title">MEMEMIND</div>
              <div class="card-back-sub">MATCH</div>
            </div>
          </div>

          <!-- Front Face: Pure Crisp Meme Photo -->
          <div class="card-face front arcade-front-face" style="--meme-glow-color: ${cardData.color || '#00f2fe'}">
            <div class="card-photo-container">
              <img src="${cardData.imagePath}" alt="${cardData.name}" class="meme-full-img" loading="eager" onerror="this.onerror=null; this.src='/images/memes/doge.jpg';" />
              <div class="card-photo-badge">
                <span class="card-photo-title">${cardData.name}</span>
              </div>
            </div>
          </div>
        </div>
      `;

      cardEl.addEventListener('click', (e) => this.handleCardClick(idx, cardEl));
      this.dom.grid.appendChild(cardEl);

      return {
        ...cardData,
        element: cardEl,
        isFlipped: false,
        isMatched: false
      };
    });
  }

  /**
   * Core Card Click Handler
   * Enforces PS09 Invariants:
   * 1. Rejects clicks during resolution (3rd card lock)
   * 2. Rejects click on already flipped card
   * 3. Rejects click on already matched card
   */
  handleCardClick(index, element) {
    if (this.isGameWon) return;

    const card = this.cards[index];
    if (!card) return;

    // INVARIANT 1: Prevent 3rd selection while two unmatched cards are resolving
    if (this.isResolvingPair) {
      this.telemetry.rapidClicksRejected++;
      window.synapseAudio.playReject();
      this.logEvent(`Blocked 3rd selection on card #${index} while resolving pair.`, 'warn');
      return;
    }

    // INVARIANT 2: Handle click on already matched card
    if (card.isMatched) {
      this.telemetry.matchedClicksIgnored++;
      window.synapseAudio.playReject();
      this.logEvent(`Ignored click on already matched pair [${card.name}].`, 'info');
      return;
    }

    // INVARIANT 3: Handle repeat click on the currently flipped first card
    if (card.isFlipped) {
      this.telemetry.repeatClicksIgnored++;
      this.logEvent(`Ignored duplicate click on already revealed card #${index}.`, 'info');
      return;
    }

    // Start active timer upon the very first card revelation
    if (!this.isGameActive) {
      this.isGameActive = true;
      this.startTimer();
    }

    // Reveal this card
    this.revealCard(card);
    this.flippedCards.push(card);
    window.synapseAudio.playFlip();

    // Check if this was card 1 or card 2 of the pair attempt
    if (this.flippedCards.length === 1) {
      this.logEvent(`Card 1 revealed: [${card.name}] at #${index}`, 'info');
    } else if (this.flippedCards.length === 2) {
      // Completed an attempt: Increment moves counter
      this.moves++;
      this.updateDashboardMetrics();
      this.checkPairMatch();
    }
  }

  revealCard(card) {
    card.isFlipped = true;
    card.element.classList.add('flipped');
  }

  unrevealCard(card) {
    card.isFlipped = false;
    card.element.classList.remove('flipped');
    card.element.classList.remove('mismatch');
  }

  checkPairMatch() {
    const [card1, card2] = this.flippedCards;
    const isMatch = card1.pairId === card2.pairId;

    if (isMatch) {
      // MATCH FOUND
      card1.isMatched = true;
      card2.isMatched = true;
      card1.element.classList.add('matched');
      card2.element.classList.add('matched');

      this.pairsMatched++;
      this.flippedCards = [];
      window.synapseAudio.playMatch();
      this.logEvent(`Match confirmed! [${card1.name}] (Pairs: ${this.pairsMatched}/${this.totalPairs})`, 'success');
      this.updateDashboardMetrics();

      // Show match popup modal (matching user's screenshot)
      this.showMatchPopup(card1);

      // Check win condition
      if (this.pairsMatched === this.totalPairs) {
        if (this.finalWinTimeout !== null) {
          clearTimeout(this.finalWinTimeout);
        }
        this.finalWinTimeout = setTimeout(() => {
          this.finalWinTimeout = null;
          this.closeMatchPopup();
          this.handleGameWon();
        }, 1400);
      }
    } else {
      // MISMATCH: Lock inputs and start resolution timer
      this.isResolvingPair = true;
      card1.element.classList.add('mismatch');
      card2.element.classList.add('mismatch');
      window.synapseAudio.playMismatch();
      this.logEvent(`Mismatch: [${card1.name}] ≠ [${card2.name}]. Resolving...`, 'warn');

      const delay = this.boardData.config?.mismatchDelayMs || 900;

      // Tracked timeout ID for clean restart teardown
      this.pendingFlipTimeout = setTimeout(() => {
        this.unrevealCard(card1);
        this.unrevealCard(card2);
        this.flippedCards = [];
        this.isResolvingPair = false;
        this.pendingFlipTimeout = null;
        this.logEvent('Pair resolution complete. Matrix unlocked.', 'info');
      }, delay);
    }
  }

  /**
   * Win State & Explainable Adaptation
   */
  async handleGameWon() {
    this.isGameWon = true;
    this.isGameActive = false;
    this.stopTimer();
    window.synapseAudio.playVictory();

    const elapsedSeconds = Number((this.elapsedActiveMs / 1000).toFixed(1));
    this.logEvent(`🏆 WIN STATE: Matrix calibrated in ${this.moves} moves and ${elapsedSeconds}s!`, 'success');

    // Trigger fireworks/particle celebration
    this.triggerWinParticles();

    // Submit session performance to Express backend for explainable adaptation calculation
    try {
      const response = await fetch('/api/game/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed: this.currentSeed,
          difficulty: this.currentDifficulty,
          moves: this.moves,
          pairs: this.totalPairs,
          elapsedSeconds,
          clientEvents: this.telemetry
        })
      });

      if (!response.ok) throw new Error('Failed to record session');
      const result = await response.json();
      this.triggerLevelTransitionAnimation(result.adaptation, result.metrics);
    } catch (err) {
      console.warn('Session API offline, utilizing client-side explainable rule evaluator:', err);
      const clientEval = window.SynapseAdaptiveClient.evaluateSession({
        difficulty: this.currentDifficulty,
        moves: this.moves,
        pairs: this.totalPairs,
        elapsedSeconds
      });
      this.triggerLevelTransitionAnimation(clientEval, clientEval.metrics);
    }
  }

  showMatchPopup(card) {
    if (!this.dom.matchPopupModal) return;

    if (this.dom.matchPopupImg) {
      this.dom.matchPopupImg.src = card.imagePath || '';
      this.dom.matchPopupImg.alt = card.name || 'Meme Match';
    }
    if (this.dom.matchPopupTitle) {
      this.dom.matchPopupTitle.textContent = `It's a match! Well done! You found ${card.name}`;
    }
    if (this.dom.matchPopupSub) {
      this.dom.matchPopupSub.textContent = card.subtitle ? `"${card.subtitle}"` : 'Iconic Internet Legend';
    }

    this.dom.matchPopupModal.classList.add('active');

    if (this.matchPopupTimeout) {
      clearTimeout(this.matchPopupTimeout);
    }
    this.matchPopupTimeout = setTimeout(() => {
      this.closeMatchPopup();
    }, 2400);
  }

  closeMatchPopup() {
    if (this.dom.matchPopupModal) {
      this.dom.matchPopupModal.classList.remove('active');
    }
    if (this.matchPopupTimeout) {
      clearTimeout(this.matchPopupTimeout);
      this.matchPopupTimeout = null;
    }
  }

  triggerLevelTransitionAnimation(adaptation, metrics) {
    const nextLevel = this.currentLevel + 1;
    // CRITICAL FIX: adaptation.nextDifficulty from the backend adaptive engine is the strict single source of truth!
    const nextDifficulty = adaptation?.nextDifficulty || this.currentDifficulty;
    const action = adaptation?.action || 'MAINTAIN';

    const diffLabels = {
      novice: 'NPC Tutorial (3×4 Matrix)',
      standard: 'Dank Meme Matrix (4×4 Matrix)',
      advanced: 'Gigachad Galaxy (6×6 Matrix - 18 Pairs)'
    };
    const nextDiffLabel = diffLabels[nextDifficulty] || nextDifficulty.toUpperCase();

    const titleEl = document.getElementById('level-transition-title');
    if (titleEl) {
      if (action === 'PROMOTE') {
        titleEl.textContent = `LEVEL ${this.currentLevel} COMPLETE! PROMOTED!`;
      } else if (action === 'DEMOTE') {
        titleEl.textContent = `LEVEL ${this.currentLevel} COMPLETE! RECOVERY MODE`;
      } else {
        titleEl.textContent = `LEVEL ${this.currentLevel} COMPLETE!`;
      }
    }

    const subEl = document.getElementById('level-transition-sub');
    if (subEl) {
      if (action === 'PROMOTE') {
        subEl.innerHTML = `Ascending into <strong>Level ${nextLevel}: ${nextDiffLabel}</strong>`;
      } else if (action === 'DEMOTE') {
        subEl.innerHTML = `Stepping down into <strong>Level ${nextLevel}: ${nextDiffLabel}</strong>`;
      } else {
        subEl.innerHTML = `Continuing at <strong>Level ${nextLevel}: ${nextDiffLabel}</strong>`;
      }
    }

    const statMoves = document.getElementById('trans-stat-moves');
    if (statMoves) statMoves.textContent = metrics?.actualMoves || this.moves;
    const statTime = document.getElementById('trans-stat-time');
    if (statTime) statTime.textContent = `${metrics?.elapsedSeconds || (this.elapsedActiveMs / 1000).toFixed(1)}s`;
    const statIq = document.getElementById('trans-stat-iq');
    if (statIq) statIq.textContent = `${metrics?.efficiency || 100}%`;

    const countdownText = document.getElementById('countdown-number');
    const countdownBar = document.getElementById('level-countdown-bar');
    const continueBtn = document.getElementById('btn-continue-level-now');

    if (continueBtn) {
      continueBtn.textContent = `Play Level ${nextLevel} Now ➔`;
    }

    if (countdownBar) {
      countdownBar.style.transition = 'none';
      countdownBar.style.width = '100%';
      void countdownBar.offsetWidth; // Force reflow
      countdownBar.style.transition = 'width 3.5s linear';
      countdownBar.style.width = '0%';
    }

    let remainingSeconds = 3;
    if (countdownText) countdownText.textContent = remainingSeconds;

    if (this.levelTransitionInterval) {
      clearInterval(this.levelTransitionInterval);
      this.levelTransitionInterval = null;
    }

    const advanceToLevel = () => {
      this.closeLevelTransition();
      this.currentLevel = nextLevel;
      if (this.dom.hudLevelIndicator) {
        this.dom.hudLevelIndicator.textContent = `LEVEL ${this.currentLevel}`;
      }
      this.currentDifficulty = nextDifficulty;
      if (this.dom.difficultySelect) {
        this.dom.difficultySelect.value = nextDifficulty;
      }
      const freshSeed = `DOGE-L${this.currentLevel}_${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
      if (this.dom.seedInput) {
        this.dom.seedInput.value = freshSeed;
      }
      this.loadNewGame(freshSeed, nextDifficulty);
      window.synapseAudio.playVictory();
    };

    if (continueBtn) {
      continueBtn.onclick = () => advanceToLevel();
    }

    this.levelTransitionInterval = setInterval(() => {
      remainingSeconds--;
      if (countdownText) countdownText.textContent = remainingSeconds;
      if (remainingSeconds <= 0) {
        clearInterval(this.levelTransitionInterval);
        this.levelTransitionInterval = null;
        advanceToLevel();
      }
    }, 1000);

    if (this.dom.levelTransitionModal) {
      this.dom.levelTransitionModal.classList.add('active');
    }
  }

  closeLevelTransition() {
    if (this.dom.levelTransitionModal) {
      this.dom.levelTransitionModal.classList.remove('active');
    }
    if (this.levelTransitionInterval) {
      clearInterval(this.levelTransitionInterval);
      this.levelTransitionInterval = null;
    }
  }

  showWinModal(adaptation, metrics) {
    if (!this.dom.winModal) return;

    const elMoves = document.getElementById('modal-metric-moves') || document.getElementById('modal-win-moves');
    if (elMoves) elMoves.textContent = metrics.actualMoves;

    const elTime = document.getElementById('modal-metric-time') || document.getElementById('modal-win-time');
    if (elTime) elTime.textContent = `${metrics.elapsedSeconds}s`;

    const elEff = document.getElementById('modal-metric-efficiency') || document.getElementById('modal-win-efficiency');
    if (elEff) elEff.textContent = `${metrics.efficiency}%`;

    const badge = document.getElementById('modal-adapt-action-badge') || document.getElementById('modal-adaptation-badge');
    if (badge) {
      badge.textContent = `${adaptation.action}: ${adaptation.nextDifficulty.toUpperCase()}`;
    }

    const title = document.getElementById('modal-adapt-title');
    if (title) {
      title.textContent = adaptation.action === 'PROMOTED'
        ? `Promoted to ${adaptation.nextDifficulty.toUpperCase()}`
        : (adaptation.action === 'DEMOTED' ? `Recalibrated to ${adaptation.nextDifficulty.toUpperCase()}` : `Retaining ${adaptation.nextDifficulty.toUpperCase()}`);
    }

    const reason = document.getElementById('modal-adapt-reason') || document.getElementById('modal-adaptation-reason');
    if (reason) reason.textContent = adaptation.detailedExplanation;

    const adaptCard = document.getElementById('modal-adaptation-card');
    if (adaptCard) {
      adaptCard.className = `adaptation-card ${adaptation.action.toLowerCase()}`;
    }

    // Next round action button
    const btnNext = document.getElementById('btn-next-round') || document.getElementById('btn-modal-next-round');
    if (btnNext) {
      btnNext.onclick = () => {
        this.closeModal(this.dom.winModal);
        // Auto-switch to next difficulty
        if (this.dom.difficultySelect) this.dom.difficultySelect.value = adaptation.nextDifficulty;
        this.currentDifficulty = adaptation.nextDifficulty;
        // Auto-generate fresh seed for next round
        const nextSeed = `DOGE_${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
        if (this.dom.seedInput) this.dom.seedInput.value = nextSeed;
        this.loadNewGame(nextSeed, this.currentDifficulty);
      };
    }

    this.openModal(this.dom.winModal);
  }

  triggerWinParticles() {
    // Elegant canvas/DOM particle shockwave
    const container = document.body;
    for (let i = 0; i < 35; i++) {
      const p = document.createElement('div');
      p.className = 'win-particle';
      p.style.cssText = `
        position: fixed;
        left: ${50 + (Math.random() - 0.5) * 40}vw;
        top: ${40 + (Math.random() - 0.5) * 30}vh;
        width: ${Math.random() * 8 + 4}px;
        height: ${Math.random() * 8 + 4}px;
        background: ${['#00f2fe', '#4facfe', '#9d4edd', '#10b981', '#f59e0b'][Math.floor(Math.random() * 5)]};
        border-radius: 50%;
        box-shadow: 0 0 10px currentColor;
        pointer-events: none;
        z-index: 999;
        transition: all 1.2s cubic-bezier(0.1, 1, 0.1, 1);
      `;
      container.appendChild(p);
      setTimeout(() => {
        p.style.transform = `translate(${(Math.random() - 0.5) * 600}px, ${(Math.random() - 0.5) * 600}px) scale(0)`;
        p.style.opacity = '0';
      }, 20);
      setTimeout(() => p.remove(), 1300);
    }
  }

  /* Active Time Tracker */
  startTimer() {
    this.isTimerRunning = true;
    this.startTime = performance.now() - this.elapsedActiveMs;
    this.timerInterval = setInterval(() => {
      if (this.isTimerRunning) {
        this.elapsedActiveMs = performance.now() - this.startTime;
        this.updateTimeDisplay();
      }
    }, 100);
  }

  pauseTimer() {
    if (this.isTimerRunning) {
      this.isTimerRunning = false;
      clearInterval(this.timerInterval);
    }
  }

  resumeTimer() {
    if (!this.isTimerRunning && this.isGameActive && !this.isGameWon) {
      this.startTimer();
    }
  }

  stopTimer() {
    this.isTimerRunning = false;
    clearInterval(this.timerInterval);
  }

  updateTimeDisplay() {
    const totalSec = Math.floor(this.elapsedActiveMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (this.dom.dormerTime) {
      this.dom.dormerTime.textContent = formatted;
    }
  }

  updateDashboardMetrics() {
    const theoreticalMin = this.totalPairs;
    const eff = this.moves > 0 ? Math.round((theoreticalMin / this.moves) * 100) : 100;

    if (this.dom.hudPairs) this.dom.hudPairs.textContent = `${this.pairsMatched}/${this.totalPairs}`;
    if (this.dom.hudMoves) this.dom.hudMoves.textContent = this.moves;
    if (this.dom.hudIq) this.dom.hudIq.textContent = `${eff}%`;

    if (this.dom.dormerScore) {
      const score = Math.max(100, (this.pairsMatched * 500) - (this.moves * 25));
      this.dom.dormerScore.textContent = score;
    }
  }

  logEvent(message, type = 'info') {
    // Clean diagnostic logger
    console.debug(`[MEMEMIND:${type}] ${message}`);
  }

  openModal(modal) {
    if (modal) modal.classList.add('active');
  }

  closeModal(modal) {
    if (modal) modal.classList.remove('active');
  }
}

// Global game instance for browser environments
if (typeof window !== 'undefined') {
  window.synapseGame = new SynapseGame();
  window.addEventListener('DOMContentLoaded', () => {
    window.synapseGame.init();
  });
}

// Module export for Jest automated testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SynapseGame };
}
