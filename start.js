// Lightfarer — Start sequence
// ---------------------------------------------------------------
// Renders the title screen + Dawn-star picker BEFORE the cosmos.
// State machine:
//   gameScreen = 'title'   → hero painting + "Begin" pill
//   gameScreen = 'picker'  → card carousel of 5 Dawn stars
//   gameScreen = 'cosmos'  → existing cosmos view (post-pick)
//
// Exposes globals consumed by cosmos.js:
//   window.gameScreen        : current screen
//   window.chosenStartStar   : key of the picked Dawn star ('inanna' etc.)
//   window.startSeqDraw(t)   : draw current screen if not 'cosmos'
//   window.startSeqHandleClick(x, y) : returns true if it consumed the click
//   window.startSeqHandleKey(e)      : returns true if it consumed the key

(function () {
  const canvas = document.getElementById('stage');

  // Public state
  window.gameScreen = 'title';
  window.chosenStartStar = null;

  // The 5 Dawn stars in pentagon order (matching FIGURES inner-ring layout).
  // Sophia at top, then CCW: Vishnu, Nüwa, Osiris, Inanna.
  const DAWN_CARDS = [
    { key: 'inanna', label: 'Inanna',  epithet: 'Queen of Heaven & Earth' },
    { key: 'osiris', label: 'Osiris',  epithet: 'Lord of the Risen Sun' },
    { key: 'sophia', label: 'Sophia',  epithet: 'Mother of Wisdom' },
    { key: 'vishnu', label: 'Vishnu',  epithet: 'Preserver of Worlds' },
    { key: 'nuwa',   label: 'Nüwa',    epithet: 'Mender of the Sky' },
  ];

  // Carousel index (0..4). Center card is the focused one.
  let cardIndex = 0;
  // Eased version for smooth scrolling.
  let cardIndexEased = 0;

  // Hit zones populated each frame.
  let beginHit = null;       // {x,y,r} on title screen
  let leftArrowHit = null;   // picker
  let rightArrowHit = null;  // picker
  let confirmHit = null;     // picker — "Choose <name>" pill
  let cardHits = [];         // picker — clickable side cards

  // ----- Asset waiter -------------------------------------------------------
  // We rely on cosmos.js's `assets` registry. Title image + orbs + figures.
  function getAssets() {
    return (typeof assets !== 'undefined') ? assets : null;
  }

  // ----- Draw: title screen -------------------------------------------------
  function drawTitle(t) {
    const W = canvas.width / (window.devicePixelRatio || 1);
    const H = canvas.height / (window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');

    // Black base
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    const A = getAssets();
    const hero = A && A.title_dawn_council;
    if (hero && hero.complete) {
      // Cover-fit the hero painting — keep aspect, fill viewport.
      const iw = hero.naturalWidth;
      const ih = hero.naturalHeight;
      const scale = Math.max(W / iw, H / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(hero, (W - dw) / 2, (H - dh) / 2, dw, dh);

      // Soft top + bottom vignettes for legibility.
      const topGrad = ctx.createLinearGradient(0, 0, 0, H * 0.4);
      topGrad.addColorStop(0, 'rgba(0,0,0,0.55)');
      topGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, W, H * 0.4);
      const botGrad = ctx.createLinearGradient(0, H * 0.6, 0, H);
      botGrad.addColorStop(0, 'rgba(0,0,0,0)');
      botGrad.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = botGrad;
      ctx.fillRect(0, H * 0.6, W, H * 0.4);
    }

    // Title — gentle breath
    const breath = 0.5 + 0.5 * Math.sin(t * 0.0008);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const titleSize = Math.min(W, H) * 0.085;
    ctx.font = `300 ${titleSize}px -apple-system, BlinkMacSystemFont, "Times New Roman", serif`;
    ctx.fillStyle = `rgba(248, 232, 168, ${0.92 + breath * 0.08})`;
    ctx.shadowColor = 'rgba(255, 200, 120, 0.45)';
    ctx.shadowBlur = 24;
    ctx.fillText('Lightfarer', W / 2, H * 0.18);

    // Subtitle
    ctx.shadowBlur = 0;
    const subSize = Math.min(W, H) * 0.022;
    ctx.font = `300 ${subSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.fillStyle = 'rgba(216, 201, 140, 0.75)';
    ctx.letterSpacing = '0.3em';
    ctx.fillText('A pilgrimage through the cosmos of meaning', W / 2, H * 0.18 + titleSize * 0.85);
    ctx.restore();

    // Begin pill — bottom center, breathing
    const pillW = Math.min(W * 0.22, 320);
    const pillH = Math.min(H * 0.07, 64);
    const pillX = W / 2;
    const pillY = H * 0.86;
    const pillR = pillH / 2;

    ctx.save();
    ctx.shadowColor = `rgba(255, 200, 120, ${0.4 + breath * 0.3})`;
    ctx.shadowBlur = 30 + breath * 20;
    ctx.fillStyle = `rgba(255, 220, 150, ${0.18 + breath * 0.08})`;
    roundRect(ctx, pillX - pillW / 2, pillY - pillH / 2, pillW, pillH, pillR);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(255, 220, 150, ${0.7 + breath * 0.2})`;
    roundRect(ctx, pillX - pillW / 2, pillY - pillH / 2, pillW, pillH, pillR);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 245, 215, 0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `400 ${pillH * 0.42}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.letterSpacing = '0.4em';
    ctx.fillText('BEGIN', pillX, pillY);
    ctx.restore();

    beginHit = { x: pillX, y: pillY, w: pillW, h: pillH };
  }

  // ----- Draw: picker -------------------------------------------------------
  function drawPicker(t) {
    const W = canvas.width / (window.devicePixelRatio || 1);
    const H = canvas.height / (window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');

    // Cosmic backdrop — reuse stars/gas if available, else dark gradient
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);
    const grad = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.7);
    grad.addColorStop(0, 'rgba(40, 30, 60, 0.6)');
    grad.addColorStop(1, 'rgba(8, 8, 14, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Hide the bottom hint line once we leave the title screen.
    const hint = document.getElementById('hint');
    if (hint) hint.classList.add('fade');

    // Small header at very top (small/quiet).
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const headerSize = Math.min(W, H) * 0.022;
    ctx.font = `300 ${headerSize}px sans-serif`;
    ctx.fillStyle = 'rgba(216, 201, 140, 0.55)';
    ctx.letterSpacing = '0.3em';
    ctx.fillText('CHOOSE YOUR FIRST STAR', W / 2, H * 0.06);
    ctx.restore();

    // Ease cardIndex
    cardIndexEased += (cardIndex - cardIndexEased) * 0.18;

    // Layout: center card large, side cards smaller and dimmer.
    const centerX = W / 2;
    const centerY = H * 0.55;
    const cardR = Math.min(W * 0.13, H * 0.22);  // big card half-width
    const gap = cardR * 2.2;                     // distance between card centers

    cardHits = [];
    const A = getAssets();

    // Draw cards from back to front by distance from focus
    const order = [-2, 2, -1, 1, 0];
    for (const offset of order) {
      const i = cardIndex + offset;
      if (i < 0 || i >= DAWN_CARDS.length) continue;
      const card = DAWN_CARDS[i];

      // Position relative to eased index
      const visualOffset = i - cardIndexEased;
      const x = centerX + visualOffset * gap;
      const dist = Math.abs(visualOffset);
      const scale = Math.max(0.45, 1 - dist * 0.28);
      const alpha = Math.max(0.25, 1 - dist * 0.45);
      const r = cardR * scale;

      // Skip cards that ended up way off screen
      if (x < -r * 2 || x > W + r * 2) continue;

      drawCard(ctx, card, x, centerY, r, alpha, t, A, dist < 0.5);
      cardHits.push({ key: card.key, index: i, x, y: centerY, r, focused: dist < 0.5 });
    }

    // Focused card name + epithet — sits above the cards in its own band.
    // Pill below the cards has its own clean space.
    const focused = DAWN_CARDS[cardIndex];
    if (focused) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(248, 232, 168, 0.95)';
      const nameSize = Math.min(W, H) * 0.046;
      ctx.font = `300 ${nameSize}px -apple-system, BlinkMacSystemFont, "Times New Roman", serif`;
      ctx.shadowColor = 'rgba(255, 200, 120, 0.5)';
      ctx.shadowBlur = 18;
      ctx.fillText(focused.label, W / 2, H * 0.14);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(216, 201, 140, 0.75)';
      ctx.font = `300 italic ${Math.min(W, H) * 0.02}px serif`;
      ctx.fillText(focused.epithet, W / 2, H * 0.14 + nameSize * 1.15);
      ctx.restore();
    }

    // Arrows
    const arrowR = Math.min(W, H) * 0.035;
    leftArrowHit  = { x: W * 0.08, y: centerY, r: arrowR };
    rightArrowHit = { x: W * 0.92, y: centerY, r: arrowR };
    drawArrow(ctx, leftArrowHit.x, leftArrowHit.y, arrowR, 'left',  cardIndex > 0);
    drawArrow(ctx, rightArrowHit.x, rightArrowHit.y, arrowR, 'right', cardIndex < DAWN_CARDS.length - 1);

    // Confirm pill
    const breath = 0.5 + 0.5 * Math.sin(t * 0.0008);
    const pillW = Math.min(W * 0.26, 380);
    const pillH = Math.min(H * 0.065, 60);
    const pillX = W / 2;
    const pillY = H * 0.88;
    const pillR = pillH / 2;
    ctx.save();
    ctx.shadowColor = `rgba(255, 200, 120, ${0.4 + breath * 0.3})`;
    ctx.shadowBlur = 30 + breath * 20;
    ctx.fillStyle = `rgba(255, 220, 150, ${0.18 + breath * 0.08})`;
    roundRect(ctx, pillX - pillW / 2, pillY - pillH / 2, pillW, pillH, pillR);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(255, 220, 150, ${0.75})`;
    roundRect(ctx, pillX - pillW / 2, pillY - pillH / 2, pillW, pillH, pillR);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 245, 215, 0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `400 ${pillH * 0.4}px sans-serif`;
    ctx.letterSpacing = '0.3em';
    ctx.fillText(`ENTER ${focused ? focused.label.toUpperCase() : ''}`, pillX, pillY);
    ctx.restore();

    confirmHit = { x: pillX, y: pillY, w: pillW, h: pillH };
  }

  function drawCard(ctx, card, x, y, r, alpha, t, A, isFocused) {
    // Use the existing orb assets — keeps continuity with the cosmos.
    const figure = A && A['figure_' + card.key];
    const orb = A && A['orb_' + card.key];

    // Soft halo for the focused card
    if (isFocused) {
      const breath = 0.5 + 0.5 * Math.sin(t * 0.001);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * (0.4 + breath * 0.2);
      const haloGrad = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 1.6);
      haloGrad.addColorStop(0, 'rgba(255, 215, 150, 0.5)');
      haloGrad.addColorStop(1, 'rgba(255, 215, 150, 0)');
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    // Orb shell
    if (orb && orb.complete) {
      ctx.drawImage(orb, x - r, y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = 'rgba(120, 100, 60, 0.4)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Figure clipped to orb interior — match cosmos drawOrb defaults
    if (figure && figure.complete) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
      ctx.clip();
      // Approximate figScale; using figure's own canvas-fill assumption ~1.7
      // works well enough for picker preview; Inanna/Osiris/Sophia/Vishnu/Nüwa
      // were all hand-tuned in cosmos.js but a constant here is fine.
      const figScale = 1.85;
      const figSize = r * figScale;
      ctx.drawImage(figure, x - figSize / 2, y - figSize / 2 + r * 0.04, figSize, figSize);
      ctx.restore();
    }

    ctx.restore();
  }

  function drawArrow(ctx, x, y, r, dir, enabled) {
    ctx.save();
    ctx.globalAlpha = enabled ? 0.85 : 0.25;
    ctx.strokeStyle = 'rgba(248, 232, 168, 1)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (dir === 'left') {
      ctx.moveTo(x + r * 0.4, y - r * 0.5);
      ctx.lineTo(x - r * 0.4, y);
      ctx.lineTo(x + r * 0.4, y + r * 0.5);
    } else {
      ctx.moveTo(x - r * 0.4, y - r * 0.5);
      ctx.lineTo(x + r * 0.4, y);
      ctx.lineTo(x - r * 0.4, y + r * 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  // ----- Hit testing --------------------------------------------------------
  function pointInPill(p, x, y) {
    if (!p) return false;
    return x >= p.x - p.w / 2 && x <= p.x + p.w / 2 && y >= p.y - p.h / 2 && y <= p.y + p.h / 2;
  }
  function pointInCircle(c, x, y) {
    if (!c) return false;
    const dx = x - c.x, dy = y - c.y;
    return dx * dx + dy * dy <= c.r * c.r;
  }

  // ----- Public API ---------------------------------------------------------
  window.startSeqDraw = function (t) {
    if (window.gameScreen === 'title')  drawTitle(t);
    else if (window.gameScreen === 'picker') drawPicker(t);
  };

  window.startSeqWantsPointer = function (x, y) {
    if (window.gameScreen === 'title') {
      return pointInPill(beginHit, x, y);
    }
    if (window.gameScreen === 'picker') {
      if (pointInPill(confirmHit, x, y)) return true;
      if (pointInCircle(leftArrowHit, x, y) && cardIndex > 0) return true;
      if (pointInCircle(rightArrowHit, x, y) && cardIndex < DAWN_CARDS.length - 1) return true;
      for (const h of cardHits) {
        if (!h.focused && pointInCircle({ x: h.x, y: h.y, r: h.r }, x, y)) return true;
      }
    }
    return false;
  };

  window.startSeqHandleClick = function (x, y) {
    if (window.gameScreen === 'title') {
      if (pointInPill(beginHit, x, y)) {
        window.gameScreen = 'picker';
        return true;
      }
      return true; // consume all clicks while on title screen
    }
    if (window.gameScreen === 'picker') {
      if (pointInPill(confirmHit, x, y)) {
        const focused = DAWN_CARDS[cardIndex];
        window.chosenStartStar = focused.key;
        window.gameScreen = 'cosmos';
        // Notify cosmos.js so it can hide non-chosen orbs etc.
        if (typeof window.onStartStarChosen === 'function') {
          window.onStartStarChosen(focused.key);
        }
        return true;
      }
      if (pointInCircle(leftArrowHit, x, y) && cardIndex > 0) {
        cardIndex -= 1;
        return true;
      }
      if (pointInCircle(rightArrowHit, x, y) && cardIndex < DAWN_CARDS.length - 1) {
        cardIndex += 1;
        return true;
      }
      // Click a side card to bring it to focus.
      for (const h of cardHits) {
        if (!h.focused && pointInCircle({ x: h.x, y: h.y, r: h.r }, x, y)) {
          cardIndex = h.index;
          return true;
        }
      }
      return true; // consume all clicks while on picker screen
    }
    return false;
  };

  window.startSeqHandleKey = function (e) {
    if (window.gameScreen === 'title') {
      if (e.key === 'Enter' || e.key === ' ') {
        window.gameScreen = 'picker';
        return true;
      }
    } else if (window.gameScreen === 'picker') {
      if (e.key === 'ArrowLeft' && cardIndex > 0) {
        cardIndex -= 1;
        return true;
      }
      if (e.key === 'ArrowRight' && cardIndex < DAWN_CARDS.length - 1) {
        cardIndex += 1;
        return true;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const focused = DAWN_CARDS[cardIndex];
        window.chosenStartStar = focused.key;
        window.gameScreen = 'cosmos';
        if (typeof window.onStartStarChosen === 'function') {
          window.onStartStarChosen(focused.key);
        }
        return true;
      }
    }
    return false;
  };
})();
