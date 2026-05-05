// Lightfarer — Start sequence
// ---------------------------------------------------------------
// Renders the title screen + Dawn-star picker BEFORE the cosmos.
// State machine:
//   gameScreen = 'title'   → hero painting + "Begin" pill
//   gameScreen = 'picker'  → SAME painting, with a sacred flame
//                            hovering over one sage at a time
//                            (left/right to drift; Enter confirms)
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

  // The 5 Dawn sages, listed left-to-right as they appear in the painting.
  // hx/hy are the head position in IMAGE space (0..1), measured directly
  // from title_dawn_council.jpg (2048×1143).
  const DAWN_SAGES = [
    { key: 'inanna', label: 'Inanna', epithet: 'Queen of Heaven & Earth',
      hx: 0.165, hy: 0.34 },
    { key: 'osiris', label: 'Osiris', epithet: 'Lord of the Risen Sun',
      hx: 0.330, hy: 0.30 },
    { key: 'sophia', label: 'Sophia', epithet: 'Mother of Wisdom',
      hx: 0.460, hy: 0.34 },
    { key: 'vishnu', label: 'Vishnu', epithet: 'Preserver of Worlds',
      hx: 0.640, hy: 0.32 },
    { key: 'nuwa',   label: 'Nüwa',   epithet: 'Mender of the Sky',
      hx: 0.830, hy: 0.33 },
  ];

  // Currently-focused sage index (0..4).
  let sageIndex = 0;
  // Eased index for smooth flame drift.
  let sageIndexEased = 0;
  // 0..1 fade for the title text once the player clicks BEGIN.
  let titleFade = 1;
  // 0..1 fade-in for the flame + halo after BEGIN.
  let pickerFade = 0;

  // Hit zones populated each frame.
  let beginHit = null;       // title — BEGIN pill
  let leftArrowHit = null;   // picker — left chevron
  let rightArrowHit = null;  // picker — right chevron
  let confirmHit = null;     // picker — ENTER pill
  let sageHits = [];         // picker — clickable sage zones in screen space

  // ----- Asset waiter -------------------------------------------------------
  // We rely on cosmos.js's `assets` registry. Title image + orbs + figures.
  function getAssets() {
    return (typeof assets !== 'undefined') ? assets : null;
  }

  // Compute the same cover-fit transform used to draw the painting, so we
  // can project head positions (in image-space 0..1) onto the screen.
  function getHeroTransform(W, H, hero) {
    const iw = hero.naturalWidth;
    const ih = hero.naturalHeight;
    const scale = Math.max(W / iw, H / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    return { scale, dw, dh, dx, dy, iw, ih };
  }
  function projectHead(sage, tr) {
    return {
      x: tr.dx + sage.hx * tr.dw,
      y: tr.dy + sage.hy * tr.dh,
    };
  }

  // ----- Shared painting backdrop ------------------------------------------
  // Used by both the title and picker screens so the painting is one continuous
  // canvas the player never leaves.
  function drawHero(ctx, W, H) {
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);
    const A = getAssets();
    const hero = A && A.title_dawn_council;
    if (!hero || !hero.complete) return null;
    const tr = getHeroTransform(W, H, hero);
    ctx.drawImage(hero, tr.dx, tr.dy, tr.dw, tr.dh);
    return tr;
  }

  function drawVignettes(ctx, W, H, topAlpha, botAlpha) {
    const topGrad = ctx.createLinearGradient(0, 0, 0, H * 0.4);
    topGrad.addColorStop(0, `rgba(0,0,0,${topAlpha})`);
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, W, H * 0.4);
    const botGrad = ctx.createLinearGradient(0, H * 0.6, 0, H);
    botGrad.addColorStop(0, 'rgba(0,0,0,0)');
    botGrad.addColorStop(1, `rgba(0,0,0,${botAlpha})`);
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, H * 0.6, W, H * 0.4);
  }

  // ----- Draw: title screen -------------------------------------------------
  function drawTitle(t) {
    const W = canvas.width / (window.devicePixelRatio || 1);
    const H = canvas.height / (window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');

    drawHero(ctx, W, H);
    drawVignettes(ctx, W, H, 0.55, 0.7);

    const breath = 0.5 + 0.5 * Math.sin(t * 0.0008);

    // Title text — fades out once we leave the title screen.
    if (titleFade > 0.001) {
      ctx.save();
      ctx.globalAlpha = titleFade;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const titleSize = Math.min(W, H) * 0.085;
      ctx.font = `300 ${titleSize}px -apple-system, BlinkMacSystemFont, "Times New Roman", serif`;
      ctx.fillStyle = `rgba(248, 232, 168, ${0.92 + breath * 0.08})`;
      ctx.shadowColor = 'rgba(255, 200, 120, 0.45)';
      ctx.shadowBlur = 24;
      ctx.fillText('Lightfarer', W / 2, H * 0.18);
      ctx.shadowBlur = 0;
      const subSize = Math.min(W, H) * 0.022;
      ctx.font = `300 ${subSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillStyle = 'rgba(216, 201, 140, 0.75)';
      ctx.letterSpacing = '0.3em';
      ctx.fillText('A pilgrimage through the cosmos of meaning', W / 2, H * 0.18 + titleSize * 0.85);
      ctx.restore();
    }

    // BEGIN pill — bottom center, breathing.
    const pillW = Math.min(W * 0.22, 320);
    const pillH = Math.min(H * 0.07, 64);
    const pillX = W / 2;
    const pillY = H * 0.86;
    const pillR = pillH / 2;

    ctx.save();
    ctx.globalAlpha = titleFade;
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

  // ----- Draw: picker (flame over the painting) ----------------------------
  function drawPicker(t) {
    const W = canvas.width / (window.devicePixelRatio || 1);
    const H = canvas.height / (window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');

    // Same painting, lighter vignettes than the title (so the sages read fully).
    const tr = drawHero(ctx, W, H);
    drawVignettes(ctx, W, H, 0.25, 0.55);

    // Hide the bottom hint line once we leave the title screen.
    const hint = document.getElementById('hint');
    if (hint) hint.classList.add('fade');

    // Ease title fade & picker fade.
    titleFade += (0 - titleFade) * 0.08;
    pickerFade += (1 - pickerFade) * 0.06;
    sageIndexEased += (sageIndex - sageIndexEased) * 0.18;

    if (!tr) return;

    // Project sage head positions to screen coords.
    const headPositions = DAWN_SAGES.map(s => projectHead(s, tr));

    // Sage hit zones — a generous radius around the head for clicking.
    const hitR = Math.min(W, H) * 0.09;
    sageHits = headPositions.map((p, i) => ({ key: DAWN_SAGES[i].key, index: i, x: p.x, y: p.y, r: hitR }));

    // Focused sage halo (warm glow behind their head/torso).
    const breath = 0.5 + 0.5 * Math.sin(t * 0.001);
    const focusedHead = lerpPoint(headPositions, sageIndexEased);
    const haloR = Math.min(W, H) * 0.16;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = pickerFade * (0.55 + breath * 0.2);
    const haloGrad = ctx.createRadialGradient(
      focusedHead.x, focusedHead.y + haloR * 0.15, 0,
      focusedHead.x, focusedHead.y + haloR * 0.15, haloR
    );
    haloGrad.addColorStop(0,    'rgba(255, 215, 140, 0.55)');
    haloGrad.addColorStop(0.45, 'rgba(255, 180, 100, 0.18)');
    haloGrad.addColorStop(1,    'rgba(255, 180, 100, 0)');
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(focusedHead.x, focusedHead.y + haloR * 0.15, haloR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // The drifting flame, hovering ABOVE the focused sage.
    const flameOffsetY = -Math.min(W, H) * 0.085;
    const flameX = focusedHead.x;
    const flameY = focusedHead.y + flameOffsetY;
    drawFlame(ctx, flameX, flameY, Math.min(W, H) * 0.022, t, pickerFade);

    // Focused sage name + epithet — small, near top.
    const focused = DAWN_SAGES[sageIndex];
    if (focused) {
      ctx.save();
      ctx.globalAlpha = pickerFade;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(248, 232, 168, 0.95)';
      const nameSize = Math.min(W, H) * 0.04;
      ctx.font = `300 ${nameSize}px -apple-system, BlinkMacSystemFont, "Times New Roman", serif`;
      ctx.shadowColor = 'rgba(255, 200, 120, 0.5)';
      ctx.shadowBlur = 18;
      ctx.fillText(focused.label, W / 2, H * 0.07);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(216, 201, 140, 0.78)';
      ctx.font = `300 italic ${Math.min(W, H) * 0.018}px serif`;
      ctx.fillText(focused.epithet, W / 2, H * 0.07 + nameSize * 1.1);
      ctx.restore();
    }

    // Arrows on far edges, vertically aligned to head row.
    const arrowR = Math.min(W, H) * 0.032;
    const arrowY = focusedHead.y;
    leftArrowHit  = { x: W * 0.05, y: arrowY, r: arrowR };
    rightArrowHit = { x: W * 0.95, y: arrowY, r: arrowR };
    ctx.save();
    ctx.globalAlpha = pickerFade;
    drawArrow(ctx, leftArrowHit.x, leftArrowHit.y, arrowR, 'left',  sageIndex > 0);
    drawArrow(ctx, rightArrowHit.x, rightArrowHit.y, arrowR, 'right', sageIndex < DAWN_SAGES.length - 1);
    ctx.restore();

    // ENTER pill at the bottom — same shape as title's BEGIN pill for continuity.
    const pillW = Math.min(W * 0.26, 380);
    const pillH = Math.min(H * 0.065, 60);
    const pillX = W / 2;
    const pillY = H * 0.92;
    const pillR = pillH / 2;
    ctx.save();
    ctx.globalAlpha = pickerFade;
    ctx.shadowColor = `rgba(255, 200, 120, ${0.4 + breath * 0.3})`;
    ctx.shadowBlur = 30 + breath * 20;
    ctx.fillStyle = `rgba(255, 220, 150, ${0.18 + breath * 0.08})`;
    roundRect(ctx, pillX - pillW / 2, pillY - pillH / 2, pillW, pillH, pillR);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 220, 150, 0.75)';
    roundRect(ctx, pillX - pillW / 2, pillY - pillH / 2, pillW, pillH, pillR);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 245, 215, 0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `400 ${pillH * 0.4}px sans-serif`;
    ctx.letterSpacing = '0.3em';
    ctx.fillText(`CHOOSE ${focused ? focused.label.toUpperCase() : ''}`, pillX, pillY);
    ctx.restore();

    confirmHit = { x: pillX, y: pillY, w: pillW, h: pillH };
  }

  // Lerp through an array of points by a fractional index (0..N-1).
  function lerpPoint(points, idx) {
    const i0 = Math.floor(idx);
    const i1 = Math.min(points.length - 1, i0 + 1);
    const f = idx - i0;
    const p0 = points[Math.max(0, Math.min(points.length - 1, i0))];
    const p1 = points[i1];
    return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f };
  }

  // Sacred flame — a flickering golden-white drop with a soft glow.
  function drawFlame(ctx, x, y, size, t, alpha) {
    if (alpha <= 0.01) return;
    const flicker = 0.85 + Math.sin(t * 0.012) * 0.07 + Math.sin(t * 0.031) * 0.05;
    const sway = Math.sin(t * 0.004) * size * 0.12;
    const cx = x + sway;
    const cy = y;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'lighter';

    // Outer glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 4.5);
    glow.addColorStop(0,   `rgba(255, 220, 150, ${0.55 * flicker})`);
    glow.addColorStop(0.4, `rgba(255, 170, 80, ${0.22 * flicker})`);
    glow.addColorStop(1,   'rgba(255, 140, 60, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Flame body — teardrop shape
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 1.6 * flicker);
    ctx.bezierCurveTo(
      cx + size * 0.9, cy - size * 0.4,
      cx + size * 0.7, cy + size * 0.6,
      cx, cy + size * 0.7
    );
    ctx.bezierCurveTo(
      cx - size * 0.7, cy + size * 0.6,
      cx - size * 0.9, cy - size * 0.4,
      cx, cy - size * 1.6 * flicker
    );
    const body = ctx.createRadialGradient(cx, cy + size * 0.2, 0, cx, cy, size * 1.6);
    body.addColorStop(0,   'rgba(255, 250, 230, 0.95)');
    body.addColorStop(0.5, 'rgba(255, 200, 120, 0.85)');
    body.addColorStop(1,   'rgba(255, 130, 60, 0.0)');
    ctx.fillStyle = body;
    ctx.fill();

    // Bright core
    ctx.beginPath();
    ctx.arc(cx, cy + size * 0.05, size * 0.45 * flicker, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 252, 240, 0.85)';
    ctx.fill();

    ctx.restore();
  }

  function drawArrow(ctx, x, y, r, dir, enabled) {
    ctx.save();
    const baseAlpha = ctx.globalAlpha;
    ctx.globalAlpha = baseAlpha * (enabled ? 0.85 : 0.25);
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

  function confirmChoice() {
    const focused = DAWN_SAGES[sageIndex];
    // Route through the central state machine in cosmos.js. This sets the
    // chosen star to GLOWING and lets syncDerivedFlags() update the legacy
    // window.chosenStartStar / logosLocked flags consistently.
    if (typeof window.chooseStartStar === 'function') {
      window.chooseStartStar(focused.key);
    } else {
      // Fallback if cosmos.js hasn't loaded yet (shouldn't happen in practice).
      window.chosenStartStar = focused.key;
    }
    window.gameScreen = 'cosmos';
    if (typeof window.onStartStarChosen === 'function') {
      window.onStartStarChosen(focused.key);
    }
  }

  window.startSeqWantsPointer = function (x, y) {
    if (window.gameScreen === 'title') {
      return pointInPill(beginHit, x, y);
    }
    if (window.gameScreen === 'picker') {
      if (pointInPill(confirmHit, x, y)) return true;
      if (pointInCircle(leftArrowHit, x, y) && sageIndex > 0) return true;
      if (pointInCircle(rightArrowHit, x, y) && sageIndex < DAWN_SAGES.length - 1) return true;
      for (const h of sageHits) {
        if (h.index !== sageIndex && pointInCircle(h, x, y)) return true;
      }
    }
    return false;
  };

  window.startSeqHandleClick = function (x, y) {
    if (window.gameScreen === 'title') {
      if (pointInPill(beginHit, x, y)) {
        window.gameScreen = 'picker';
        // Animate-out the title text via titleFade in drawPicker.
        return true;
      }
      return true; // consume all clicks while on title screen
    }
    if (window.gameScreen === 'picker') {
      if (pointInPill(confirmHit, x, y)) {
        confirmChoice();
        return true;
      }
      if (pointInCircle(leftArrowHit, x, y) && sageIndex > 0) {
        sageIndex -= 1;
        return true;
      }
      if (pointInCircle(rightArrowHit, x, y) && sageIndex < DAWN_SAGES.length - 1) {
        sageIndex += 1;
        return true;
      }
      // Click a sage to move the flame onto them.
      for (const h of sageHits) {
        if (h.index !== sageIndex && pointInCircle(h, x, y)) {
          sageIndex = h.index;
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
      if (e.key === 'ArrowLeft' && sageIndex > 0) {
        sageIndex -= 1;
        return true;
      }
      if (e.key === 'ArrowRight' && sageIndex < DAWN_SAGES.length - 1) {
        sageIndex += 1;
        return true;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        confirmChoice();
        return true;
      }
    }
    return false;
  };
})();
