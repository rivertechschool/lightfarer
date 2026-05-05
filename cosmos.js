// Lightfarer — Cosmos Prototype v2
// Four-layer painted cosmos:
//   1. Gas (slow rotation + drift, parallax shallow)
//   2. Stars (independent layer, minimal motion + per-star twinkle)
//   3. Rings (gentle pulse)
//   4. Logos (bigger, with radial halo + breath-pulse)
// Plus frame on top, vignette around.
// Plain Canvas 2D, no dependencies.

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const hint = document.getElementById('hint');

// Offscreen canvas reused by drawPortalShimmer for the masked star bloom.
let _portalLayer = null;

// Hidden <video> used as a live source for the portal interior — cosmic loop
// drawn each frame inside the carved gate. Kick it once on first interaction
// in case autoplay was deferred.
const portalVideo = document.getElementById('portalVideo');
if (portalVideo) {
  const kick = () => { portalVideo.play().catch(() => {}); };
  window.addEventListener('pointerdown', kick, { once: true });
  window.addEventListener('keydown', kick, { once: true });
}

// Per-god portal palette map. Each deity's portal interior shows a cosmic loop
// whose color matches the deity's geographic/cultural origin: lapis blue for
// Mesopotamian/Greek waters, amber for Egyptian/Hebrew/Buddhist deserts,
// emerald for Celtic/Mesoamerican greens, saffron-violet for Vedic/Iranian,
// rose-jade for Chinese/Greek harvest. Single video per god for now; the
// click-to-advance system below builds the slide-queue plumbing for future
// educational content.
// TEMPORARY: Inanna gets a multi-palette test queue so the click-to-advance
// behavior is visible. Each click on her risen portal cycles to the next
// palette (lapis → amber → emerald → saffron → rose → lapis ...). Once
// per-god educational slide content lands, restore Inanna to ['lapis'].
const DEITY_PORTALS = {
  inanna:              ['lapis', 'amber', 'emerald', 'saffron', 'rose'],
  sophia:              ['lapis'],
  socrates:            ['socrates'],
  osiris:              ['amber_clean'],
  abraham_sarah:       ['abraham_sarah'],
  buddha:              ['buddha'],
  brigid:              ['brigid'],
  hero_twins:          ['hero_twins'],
  vishnu:              ['turquoise'],
  sita:                ['sita'],
  zoroaster:           ['zoroaster'],
  nuwa:                ['rose'],
  demeter_persephone:  ['demeter_persephone'],
  logos:               ['clouds'],
};

// ===== Star illumination state =====
// Single source of truth for what every star looks like on the map.
// Every render path (orb visibility, alpha, halo, ring visibility, lock state)
// reads from window.starState — never from scattered ad-hoc flags.
//
// Tier ladder (per spec section 5):
//   0 HIDDEN   — not drawn at all
//   1 DIM      — visible but locked (muted, no clickable hover)
//   2 GLOWING  — unlocked + clickable, baseline glow
//   3 BRIGHT   — completed enough to count toward Logos / Ancient unlocks
//   4 RADIANT  — fully realized (post-completion final state)
//
// To progress the game, flip values here. Helpers below read this object.
const TIER = { HIDDEN: 0, DIM: 1, GLOWING: 2, BRIGHT: 3, RADIANT: 4 };
window.TIER = TIER;

window.starState = window.starState || {
  // Inner ring (Dawn) — all hidden until player picks one
  inanna: TIER.HIDDEN,
  osiris: TIER.HIDDEN,
  sophia: TIER.HIDDEN,
  vishnu: TIER.HIDDEN,
  nuwa:   TIER.HIDDEN,
  // Center (Logos) — visible but locked from the start
  logos:  TIER.DIM,
  // Outer ring (Ancient) — all hidden until ring unlocks
  buddha:             TIER.HIDDEN,
  sita:               TIER.HIDDEN,
  socrates:           TIER.HIDDEN,
  demeter_persephone: TIER.HIDDEN,
  abraham_sarah:      TIER.HIDDEN,
  hero_twins:         TIER.HIDDEN,
  brigid:             TIER.HIDDEN,
  zoroaster:          TIER.HIDDEN,
};

// Read helpers — every draw path uses these instead of inventing its own rule.
function tierOf(key) { return window.starState[key] ?? TIER.HIDDEN; }
function isVisible(key) { return tierOf(key) >= TIER.DIM; }
function isClickable(key) { return tierOf(key) >= TIER.GLOWING; }
function isBright(key) { return tierOf(key) >= TIER.BRIGHT; }
window.tierOf = tierOf;
window.isVisible = isVisible;
window.isClickable = isClickable;
window.isBright = isBright;

// Mutator — single entry point so changes are auditable in console.
window.setTier = function setTier(key, tier) {
  if (!(key in window.starState)) {
    console.warn('setTier: unknown star', key);
    return;
  }
  const before = window.starState[key];
  window.starState[key] = tier;
  console.log(`[starState] ${key}: ${before} -> ${tier}`);
  // Derived flags kept in sync so legacy draw code keeps working.
  syncDerivedFlags();
};

// Derive the legacy flags from starState so older draw paths keep working
// while we migrate. New code should read starState directly.
function syncDerivedFlags() {
  // chosenStartStar = whichever Dawn star is at GLOWING+ (only one until Bright)
  const dawn = ['inanna','osiris','sophia','vishnu','nuwa'];
  const lit = dawn.find(k => tierOf(k) >= TIER.GLOWING);
  window.chosenStartStar = lit || null;
  // logosLocked = Logos isn't yet GLOWING
  window.logosLocked = tierOf('logos') < TIER.GLOWING;
  // ancientRingUnlocked = all five Dawn stars are at BRIGHT+
  window.ancientRingUnlocked = dawn.every(k => tierOf(k) >= TIER.BRIGHT);
}
window.syncDerivedFlags = syncDerivedFlags;
syncDerivedFlags();

// Convenience wrappers for the most common state transitions.
// These let me say "Inanna was just chosen" instead of remembering tier numbers.
window.chooseStartStar = function chooseStartStar(key) {
  setTier(key, TIER.GLOWING);
};
window.markBright = function markBright(key) {
  setTier(key, TIER.BRIGHT);
  // Cascade rules from spec section 5:
  // 1. First Dawn star at Bright -> Logos becomes GLOWING (clickable)
  const dawn = ['inanna','osiris','sophia','vishnu','nuwa'];
  if (dawn.includes(key) && tierOf('logos') < TIER.GLOWING) {
    setTier('logos', TIER.GLOWING);
  }
  // 2. All five Dawn at Bright -> 8 Ancient stars become DIM (revealed)
  if (dawn.every(k => tierOf(k) >= TIER.BRIGHT)) {
    ['buddha','sita','socrates','demeter_persephone','abraham_sarah','hero_twins','brigid','zoroaster']
      .forEach(k => { if (tierOf(k) === TIER.HIDDEN) setTier(k, TIER.DIM); });
  }
};

// Active deity's slide queue + current index. Click-on-portal advances.
let portalSlides = ['lapis'];
let portalSlideIndex = 0;
// Most recent gate layout from drawStargate — used by the click handler to
// detect taps inside the portal opening so we can cycle slides.
let lastGateLayout = null;

function setPortalForDeity(key) {
  const slides = DEITY_PORTALS[key] || ['lapis'];
  portalSlides = slides.slice();
  portalSlideIndex = 0;
  loadPortalSlide();
}

function loadPortalSlide() {
  if (!portalVideo) return;
  const palette = portalSlides[portalSlideIndex] || 'lapis';
  const newSrc = 'assets/portal_loop_' + palette + '.mp4';
  // Avoid restarting the same source — keeps loop continuity if the deity
  // shares a palette with the previous one.
  const currentSrc = portalVideo.getAttribute('src') || '';
  if (!currentSrc.endsWith('portal_loop_' + palette + '.mp4')) {
    portalVideo.src = newSrc;
    portalVideo.load();
  }
  portalVideo.play().catch(() => {});
}

function advancePortalSlide() {
  if (!portalSlides.length) return;
  portalSlideIndex = (portalSlideIndex + 1) % portalSlides.length;
  loadPortalSlide();
}

// ===== Asset loading =====
const assets = {
  gas: new Image(),
  stars: new Image(),
  frame: new Image(),
  logos: new Image(),
  figure_inanna: new Image(),
  orb_inanna: new Image(),
  figure_osiris: new Image(),
  orb_osiris: new Image(),
  figure_sophia: new Image(),
  orb_sophia: new Image(),
  figure_vishnu: new Image(),
  orb_vishnu: new Image(),
  figure_nuwa: new Image(),
  orb_nuwa: new Image(),
  figure_buddha: new Image(),
  orb_buddha: new Image(),
  figure_socrates: new Image(),
  orb_socrates: new Image(),
  figure_sita: new Image(),
  orb_sita: new Image(),
  figure_demeter_persephone: new Image(),
  orb_demeter_persephone: new Image(),
  figure_abraham_sarah: new Image(),
  orb_abraham_sarah: new Image(),
  figure_hero_twins: new Image(),
  orb_hero_twins: new Image(),
  figure_brigid: new Image(),
  orb_brigid: new Image(),
  figure_zoroaster: new Image(),
  orb_zoroaster: new Image(),
  // Sanctum paintings — the haven each figure inhabits. Generated 16:9 to fill
  // the viewport edge-to-edge when the cosmos zooms into a star. Only Inanna
  // has a real painting at launch; other figures will follow.
  sanctum_inanna: new Image(),
  // Lesson stage components. Each sanctum has:
  //   _bg: empty-of-figure background (16:9, cover-fit to viewport)
  //   _portal: the lapis-and-gold ring with luminous interior (square)
  //   _pillar_unlit / _pillar_lit: stone answer-pillars (tall portrait)
  // Inanna's sprite (figure_inanna) is reused from the cosmos orb so we get
  // the locked face/body for free.
  sanctum_inanna_bg: new Image(),
  // Stargate is the universal lesson canvas. Built like a heavy ancient ring
  // (chevrons, segmented stones), but the inside is a living wormhole surface
  // where text/video/answers play. Each sanctum gets its own gate styled in
  // the figure's material vocabulary; Inanna's is lapis-and-gold.
  stargate_inanna: new Image(),
  // Painted swirling vortex bitmap that lives inside the gate ring — rotated
  // and counter-rotated to create a 2.5D "looking through a wormhole" feel.
  portal_interior_inanna: new Image(),
  // Sanctuary-grade sprite for Inanna — a fresh full-body painting tuned for
  // standing in the scene rather than being inside an orb. Same face as the
  // cosmos sprite (Wonder-Woman lock).
  figure_inanna_sanctum: new Image(),
  // The other four Dawn-ring deities. Each gets a (1) sanctum bg painting,
  // (2) sanctum-grade figure on transparent background, (3) stargate ring
  // styled in the deity's material vocabulary (sandstone+turquoise for
  // Osiris, white marble for Sophia, fire-bronze+ruby for Vishnu, jade for
  // Nüwa). Portal interior video swap is handled by setPortalForDeity.
  sanctum_osiris_bg: new Image(),
  stargate_osiris: new Image(),
  figure_osiris_sanctum: new Image(),
  sanctum_sophia_bg: new Image(),
  stargate_sophia: new Image(),
  figure_sophia_sanctum: new Image(),
  sanctum_vishnu_bg: new Image(),
  stargate_vishnu: new Image(),
  figure_vishnu_sanctum: new Image(),
  sanctum_nuwa_bg: new Image(),
  stargate_nuwa: new Image(),
  figure_nuwa_sanctum: new Image(),
  sanctum_logos_bg: new Image(),
  stargate_logos: new Image(),
  figure_logos_sanctum: new Image(),
  // Outer-ring sanctums. Built one at a time, same three-asset pattern
  // (bg + sanctum-grade figure on transparent + stargate ring).
  sanctum_buddha_bg: new Image(),
  stargate_buddha: new Image(),
  figure_buddha_sanctum: new Image(),
  sanctum_sita_bg: new Image(),
  stargate_sita: new Image(),
  figure_sita_sanctum: new Image(),
  sanctum_demeter_persephone_bg: new Image(),
  stargate_demeter_persephone: new Image(),
  figure_demeter_persephone_sanctum: new Image(),
  sanctum_abraham_sarah_bg: new Image(),
  stargate_abraham_sarah: new Image(),
  figure_abraham_sarah_sanctum: new Image(),
  sanctum_hero_twins_bg: new Image(),
  stargate_hero_twins: new Image(),
  figure_hero_twins_sanctum: new Image(),
  sanctum_brigid_bg: new Image(),
  stargate_brigid: new Image(),
  figure_brigid_sanctum: new Image(),
  sanctum_zoroaster_bg: new Image(),
  stargate_zoroaster: new Image(),
  figure_zoroaster_sanctum: new Image(),
  sanctum_socrates_bg: new Image(),
  stargate_socrates: new Image(),
  figure_socrates_sanctum: new Image(),
  // Title screen hero painting — 5 Dawn sages before the Logos throne.
  title_dawn_council: new Image(),
};

let loaded = 0;
const total = Object.keys(assets).length;
let started = false;
function onLoad() {
  loaded++;
  if (loaded === total && !started) {
    started = true;
    start();
  }
}
Object.values(assets).forEach((img) => (img.onload = onLoad));

// Fast-start: as soon as the title image is ready, kick off the render loop
// so the player sees the title screen immediately. Other 70+ assets keep
// loading in the background and will be ready by the time the player picks
// a star and enters the cosmos. Without this, a slow connection can stare
// at a black canvas for 10+ seconds while everything downloads serially.
assets.title_dawn_council.addEventListener('load', () => {
  if (!started) {
    started = true;
    start();
  }
});
// Hard fallback: if the title image somehow fails or stalls, kick off
// rendering after 4 seconds anyway so the user never sees a frozen page.
setTimeout(() => {
  if (!started) {
    started = true;
    start();
  }
}, 4000);

assets.gas.src = 'assets/gas.jpg';
assets.stars.src = 'assets/stars.jpg';
assets.frame.src = 'assets/frame.png';
assets.logos.src = 'assets/logos.png';
assets.figure_inanna.src = 'assets/figure_inanna.png';
assets.orb_inanna.src = 'assets/orb_inanna.png';
assets.figure_osiris.src = 'assets/figure_osiris.png';
assets.orb_osiris.src = 'assets/orb_osiris.png';
assets.figure_sophia.src = 'assets/figure_sophia.png';
assets.orb_sophia.src = 'assets/orb_sophia.png';
assets.figure_vishnu.src = 'assets/figure_vishnu.png';
assets.orb_vishnu.src = 'assets/orb_vishnu.png';
assets.figure_nuwa.src = 'assets/figure_nuwa.png';
assets.orb_nuwa.src = 'assets/orb_nuwa.png';
assets.figure_buddha.src = 'assets/figure_buddha.png';
assets.orb_buddha.src = 'assets/orb_buddha.png';
assets.figure_socrates.src = 'assets/figure_socrates.png';
assets.orb_socrates.src = 'assets/orb_socrates.png';
assets.figure_sita.src = 'assets/figure_sita.png';
assets.orb_sita.src = 'assets/orb_sita.png';
assets.figure_demeter_persephone.src = 'assets/figure_demeter_persephone.png';
assets.orb_demeter_persephone.src = 'assets/orb_demeter_persephone.png';
assets.figure_abraham_sarah.src = 'assets/figure_abraham_sarah.png';
assets.orb_abraham_sarah.src = 'assets/orb_abraham_sarah.png';
assets.figure_hero_twins.src = 'assets/figure_hero_twins.png';
assets.orb_hero_twins.src = 'assets/orb_hero_twins.png';
assets.figure_brigid.src = 'assets/figure_brigid.png';
assets.orb_brigid.src = 'assets/orb_brigid.png';
assets.figure_zoroaster.src = 'assets/figure_zoroaster.png';
assets.orb_zoroaster.src = 'assets/orb_zoroaster.png';
assets.sanctum_inanna.src = 'assets/sanctum_inanna.jpg';
assets.sanctum_inanna_bg.src = 'assets/sanctum_inanna_bg.jpg';
assets.stargate_inanna.src = 'assets/stargate_inanna.png';
assets.portal_interior_inanna.src = 'assets/portal_interior_inanna.png';
assets.figure_inanna_sanctum.src = 'assets/figure_inanna_sanctum.png';
assets.sanctum_osiris_bg.src = 'assets/sanctum_osiris_bg.jpg';
assets.stargate_osiris.src = 'assets/stargate_osiris.png';
assets.figure_osiris_sanctum.src = 'assets/figure_osiris_sanctum.png';
assets.sanctum_sophia_bg.src = 'assets/sanctum_sophia_bg.jpg';
assets.stargate_sophia.src = 'assets/stargate_sophia.png';
assets.figure_sophia_sanctum.src = 'assets/figure_sophia_sanctum.png';
assets.sanctum_vishnu_bg.src = 'assets/sanctum_vishnu_bg.jpg';
assets.stargate_vishnu.src = 'assets/stargate_vishnu.png';
assets.figure_vishnu_sanctum.src = 'assets/figure_vishnu_sanctum.png';
assets.sanctum_nuwa_bg.src = 'assets/sanctum_nuwa_bg.jpg';
assets.stargate_nuwa.src = 'assets/stargate_nuwa.png';
assets.sanctum_logos_bg.src = 'assets/sanctum_logos_bg.jpg';
assets.stargate_logos.src = 'assets/stargate_logos.png';
assets.figure_logos_sanctum.src = 'assets/figure_logos_sanctum.png';
assets.figure_nuwa_sanctum.src = 'assets/figure_nuwa_sanctum.png';
assets.sanctum_buddha_bg.src = 'assets/sanctum_buddha_bg.jpg';
assets.stargate_buddha.src = 'assets/stargate_buddha.png';
assets.figure_buddha_sanctum.src = 'assets/figure_buddha_sanctum.png';
assets.sanctum_sita_bg.src = 'assets/sanctum_sita_bg.jpg';
assets.stargate_sita.src = 'assets/stargate_sita.png';
assets.figure_sita_sanctum.src = 'assets/figure_sita_sanctum.png';
assets.sanctum_demeter_persephone_bg.src = 'assets/sanctum_demeter_persephone_bg.jpg';
assets.stargate_demeter_persephone.src = 'assets/stargate_demeter_persephone.png';
assets.figure_demeter_persephone_sanctum.src = 'assets/figure_demeter_persephone_sanctum.png';
assets.sanctum_abraham_sarah_bg.src = 'assets/sanctum_abraham_sarah_bg.jpg';
assets.stargate_abraham_sarah.src = 'assets/stargate_abraham_sarah.png';
assets.figure_abraham_sarah_sanctum.src = 'assets/figure_abraham_sarah_sanctum.png';
assets.sanctum_hero_twins_bg.src = 'assets/sanctum_hero_twins_bg.jpg';
assets.stargate_hero_twins.src = 'assets/stargate_hero_twins.png';
assets.figure_hero_twins_sanctum.src = 'assets/figure_hero_twins_sanctum.png';
assets.sanctum_brigid_bg.src = 'assets/sanctum_brigid_bg.jpg';
assets.stargate_brigid.src = 'assets/stargate_brigid.png';
assets.figure_brigid_sanctum.src = 'assets/figure_brigid_sanctum.png';
assets.sanctum_zoroaster_bg.src = 'assets/sanctum_zoroaster_bg.jpg';
assets.stargate_zoroaster.src = 'assets/stargate_zoroaster.png';
assets.figure_zoroaster_sanctum.src = 'assets/figure_zoroaster_sanctum.png';
assets.sanctum_socrates_bg.src = 'assets/sanctum_socrates_bg.jpg';
assets.stargate_socrates.src = 'assets/stargate_socrates.png';
assets.figure_socrates_sanctum.src = 'assets/figure_socrates_sanctum.png';
assets.title_dawn_council.src = 'assets/title_dawn_council.jpg';

// ===== Canvas sizing =====
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ===== Mouse parallax =====
let mxTarget = 0, myTarget = 0;
let mx = 0, my = 0;
// Raw pointer position in CSS pixels (separate from the parallax-normalized mx/my).
// Used for hover hit-testing against orbs.
let pointerX = -9999, pointerY = -9999;
window.addEventListener('mousemove', (e) => {
  mxTarget = (e.clientX / W) * 2 - 1;
  myTarget = (e.clientY / H) * 2 - 1;
  pointerX = e.clientX;
  pointerY = e.clientY;
  if (!hint.classList.contains('fade')) hint.classList.add('fade');
});
window.addEventListener('mouseleave', () => {
  pointerX = -9999;
  pointerY = -9999;
});

// ===== Twinkle seeds =====
// Generate per-position noise for star twinkle. We sample N points and use them
// as offsets into the global time so different stars twinkle at different times.
// Since stars are baked into a bitmap, we can't twinkle individually — instead
// we modulate the whole stars layer's alpha very subtly, plus draw small additive
// "sparkle" overlays at a few sampled positions for a sense of twinkle.
const sparkles = [];
for (let i = 0; i < 14; i++) {
  sparkles.push({
    // Normalized position inside cosmos rect (0..1)
    nx: Math.random(),
    ny: Math.random(),
    phase: Math.random() * Math.PI * 2,
    rate: 0.0008 + Math.random() * 0.0012, // slightly different rates
    size: 1 + Math.random() * 2,
  });
}

// ===== Frame & cosmos rect =====
// Always-letterbox / contain-fit sizing. The whole 16:9 wood frame is
// guaranteed visible on every monitor and every browser-chrome configuration,
// with painted wall (drawWallFallback) filling whatever space is left over.
//
// This is the only behavior — no edge-to-edge / cover-fit branch — because
// the wood frame is a UI surface (settings, save/load, embers will live on it)
// and any cropping makes those controls unreachable on some screens.
//
// FRAME_MARGIN: how much breathing room to leave around the frame so it
// doesn't touch the viewport edges. 0.96 = 4% wall margin on the constraining
// axis. Bumping this toward 1.0 makes the frame larger; toward 0.9 makes the
// wall margin more generous.
const FRAME_MARGIN = 0.96;

function getFrameRect() {
  const frameAspect = assets.frame.width / assets.frame.height; // ~1.778
  const viewportAspect = W / H;

  // Contain-fit: pick the axis that constrains and size the frame to fit
  // inside the viewport along that axis, with a small margin.
  let fw, fh;
  if (viewportAspect > frameAspect) {
    // Viewport is wider than frame — height is the constraint.
    fh = H * FRAME_MARGIN;
    fw = fh * frameAspect;
  } else {
    // Viewport is taller than frame — width is the constraint.
    fw = W * FRAME_MARGIN;
    fh = fw / frameAspect;
  }
  return {
    fx: (W - fw) / 2,
    fy: (H - fh) / 2,
    fw,
    fh,
    mode: 'contain',
  };
}

function getCosmosRect(frameRect) {
  const innerLeftPct = 0.117;
  const innerTopPct = 0.067;
  const innerWidthPct = 0.766;
  const innerHeightPct = 0.811;
  return {
    cx: frameRect.fx + frameRect.fw * innerLeftPct,
    cy: frameRect.fy + frameRect.fh * innerTopPct,
    cw: frameRect.fw * innerWidthPct,
    ch: frameRect.fh * innerHeightPct,
  };
}

// ===== Layer: Gas (deep, slow rotation + drift) =====
function drawGas(cosmosRect, t) {
  const { cx, cy, cw, ch } = cosmosRect;
  const centerX = cx + cw / 2;
  const centerY = cy + ch / 2;

  // Slow rotation around the cosmos center — the swirl turns
  // 360° / (60s per degree) = full revolution every ~6 minutes
  const rotation = t * 0.000017; // radians/ms; 1 full turn ~ 6 min

  // Gentle drift
  const driftX = Math.sin(t * 0.00007) * 6;
  const driftY = Math.cos(t * 0.00009) * 4;

  // Shallow parallax — gas is "deep"
  const parallaxX = mx * 10;
  const parallaxY = my * 7;

  // Overscale so rotation never reveals an edge.
  // Need at least sqrt(2) ~1.42 to cover corners under arbitrary rotation.
  const overscale = 1.5;

  ctx.save();
  // Clip to cosmos rect so layer never spills outside the frame opening
  ctx.beginPath();
  ctx.rect(cx, cy, cw, ch);
  ctx.clip();

  ctx.translate(centerX + driftX + parallaxX, centerY + driftY + parallaxY);
  ctx.rotate(rotation);

  const drawW = cw * overscale;
  const drawH = ch * overscale;
  ctx.drawImage(assets.gas, -drawW / 2, -drawH / 2, drawW, drawH);

  ctx.restore();
}

// ===== Layer: Stars (almost still, with subtle alpha breath + sparkles) =====
function drawStars(cosmosRect, t) {
  const { cx, cy, cw, ch } = cosmosRect;

  // Stars barely respond to mouse — they're very far away.
  const parallaxX = mx * 3;
  const parallaxY = my * 2;

  // Multi-wave alpha breathing: combine three sin waves at different periods
  // and offsets so the layer never reads as "all blink together." Range 0.55-0.95.
  // Painted stars are baked into a single bitmap, but layering breath waves at
  // different frequencies gives a sense of life when combined with sparkles.
  const w1 = Math.sin(t * 0.0004) * 0.5 + 0.5;
  const w2 = Math.sin(t * 0.00027 + 1.3) * 0.5 + 0.5;
  const w3 = Math.sin(t * 0.00061 + 2.7) * 0.5 + 0.5;
  const layerBreath = 0.55 + (w1 * 0.5 + w2 * 0.3 + w3 * 0.2) * 0.4;

  // Tiny independent drift so stars aren't locked to the gas underneath
  const driftX = Math.sin(t * 0.000035) * 3;
  const driftY = Math.cos(t * 0.00004) * 2;

  // Slow orbit around cosmos center — half the gas rate, opposite direction so
  // the two layers feel independent (~12 min per turn). The stars layer is far
  // away, so the rotation reads as a slow celestial drift, not a spin.
  const starsRotation = t * -0.0000085;

  ctx.save();
  ctx.beginPath();
  ctx.rect(cx, cy, cw, ch);
  ctx.clip();
  ctx.globalAlpha = layerBreath;

  // Match aspect of stars image to cosmos rect — fit to cover.
  const starsAspect = assets.stars.width / assets.stars.height;
  const cosmosAspect = cw / ch;
  let drawW, drawH;
  if (starsAspect > cosmosAspect) {
    drawH = ch;
    drawW = drawH * starsAspect;
  } else {
    drawW = cw;
    drawH = drawW / starsAspect;
  }
  // Oversize by √2 ≈ 1.42 so the rotated bitmap always covers the cosmos rect
  // (a square rotated 45° has its corners reach √2× the side). Use 1.5 for
  // safety margin against aspect mismatch.
  const rotCover = 1.5;
  drawW *= rotCover;
  drawH *= rotCover;
  const offsetX = (cw - drawW) / 2 + parallaxX + driftX;
  const offsetY = (ch - drawH) / 2 + parallaxY + driftY;

  // Rotate around the cosmos center.
  const centerX = cx + cw / 2;
  const centerY = cy + ch / 2;
  ctx.translate(centerX, centerY);
  ctx.rotate(starsRotation);
  ctx.translate(-centerX, -centerY);
  ctx.drawImage(assets.stars, cx + offsetX, cy + offsetY, drawW, drawH);

  // Restore unrotated transform for sparkles, then apply our own rotated
  // coordinate transform so sparkles orbit with the painted stars.
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.beginPath();
  ctx.rect(cx, cy, cw, ch);
  ctx.clip();

  // Twinkle sparkles — small additive points at sampled positions, rotated
  // around the cosmos center to match the painted-stars orbit.
  ctx.globalCompositeOperation = 'lighter';
  const cosA = Math.cos(starsRotation);
  const sinA = Math.sin(starsRotation);
  for (const s of sparkles) {
    const phase = s.phase + t * s.rate;
    const intensity = (Math.sin(phase) * 0.5 + 0.5); // 0..1
    if (intensity < 0.6) continue; // only draw bright pulses
    const a = (intensity - 0.6) / 0.4 * 0.6; // 0..0.6
    // Sparkle nx, ny are in 0..1 — shift to center-relative (-0.5..0.5),
    // rotate around that center, then map into cosmos pixel space.
    const dx = s.nx - 0.5;
    const dy = s.ny - 0.5;
    const rotDx = dx * cosA - dy * sinA;
    const rotDy = dx * sinA + dy * cosA;
    const px = cx + cw / 2 + rotDx * cw;
    const py = cy + ch / 2 + rotDy * ch;
    const r = s.size * (1 + intensity * 1.5);
    const grad = ctx.createRadialGradient(px, py, 0, px, py, r * 4);
    grad.addColorStop(0, `rgba(255, 240, 200, ${a})`);
    grad.addColorStop(1, 'rgba(255, 240, 200, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(px - r * 4, py - r * 4, r * 8, r * 8);
  }

  ctx.restore();
}

// ===== Layer: Rings =====
function drawRings(cosmosRect, t) {
  const { cx, cy, cw, ch } = cosmosRect;
  const centerX = cx + cw / 2;
  const centerY = cy + ch / 2;

  const parallaxX = mx * 18;
  const parallaxY = my * 12;

  // Rings sized so the home view (2 rings) fills the canvas and reads as
  // "this is the whole picture" — not zoomed-out with room for more.
  // Future expansion rings (3, 4) would live outside these, requiring zoom-out.
  const baseR = Math.min(cw, ch);
  const innerR = baseR * 0.30;
  const outerR = baseR * 0.50;
  const tilt = 0.55;

  ctx.save();
  ctx.translate(centerX + parallaxX, centerY + parallaxY);

  const pulse = 1 + Math.sin(t * 0.0006) * 0.008;

  function drawRing(r, alphaCore, alphaGlow) {
    ctx.beginPath();
    ctx.ellipse(0, 0, r * pulse, r * tilt * pulse, 0, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = `rgba(232, 196, 128, ${alphaGlow})`;
    ctx.shadowColor = `rgba(255, 210, 140, ${alphaGlow})`;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.ellipse(0, 0, r * pulse, r * tilt * pulse, 0, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(245, 218, 160, ${alphaCore})`;
    ctx.stroke();
  }

  drawRing(innerR, 0.55, 0.20);
  // Outer (Ancient) ring is hidden until the player has unlocked it.
  // Per spec section 5 layer 4: opens when all five Dawn stars are at Bright.
  // window.ancientRingUnlocked is set elsewhere when that happens.
  if (window.ancientRingUnlocked) {
    drawRing(outerR, 0.45, 0.16);
  }

  ctx.restore();
}

// ===== Figures (orbs) =====
// Each figure has a normalized polar position on a ring (ring = 'inner' | 'outer'),
// an angle in radians (0 = right/3 o'clock, increases clockwise on screen since
// screen Y is inverted), and a sprite asset key. Positions are static for now —
// no clicks, no orbit motion. Just present.
//
// Angle reference (clock face → radians):
//   12 o'clock = -π/2  (-1.5708)
//    3 o'clock =   0
//    6 o'clock =  π/2   ( 1.5708)
//    9 o'clock =  π     ( 3.1416)
//   10 o'clock ≈ -2.618 (i.e. π + π/6 → -150° from +x axis, screen-up-and-left)
const FIGURES = [
  // Inner ring: 5 figures evenly spaced around the full ring (every 2π/5 =
  // 72°). Sophia anchors at 12 o'clock (-π/2); the rest step counter-clockwise
  // from there in the order Vishnu, Nüwa, Osiris, Inanna so each figure ends
  // up roughly where she was on the partial-arc layout.
  {
    key: 'inanna',
    label: 'Inanna',
    figureAsset: 'figure_inanna',
    orbAsset: 'orb_inanna',
    ring: 'inner',
    angle: -Math.PI / 2 - 2 * Math.PI * 1 / 5, // upper-left (was -π×5/6)
    // Per-figure breath phase so they don't all pulse together.
    breathPhase: 0.0,
    // Per-figure scale factor: how much of the orb interior the figure fills.
    // Default 1.7 was tuned for Inanna's tight 84% canvas-fill crop. Figures
    // generated with looser margins need a higher value to read at the same
    // visual size on the ring.
    figScale: 1.7,
    figOffsetYPct: 0.05,
  },
  {
    key: 'osiris',
    label: 'Osiris',
    figureAsset: 'figure_osiris',
    orbAsset: 'orb_osiris',
    ring: 'inner',
    angle: -Math.PI / 2 - 2 * Math.PI * 2 / 5, // lower-left (was -π×7/6)
    breathPhase: 1.7,
    // Osiris re-rendered for cleaner alpha; canvas-fill 67.6% → 1.7/0.676 ≈ 2.51.
    figScale: 2.51,
    // Negative = nudge figure UP. Osiris has more empty space above his
    // crown than below his feet inside his canvas, so without this he sits
    // too low and the kilt clips the bottom of the orb.
    figOffsetYPct: -0.07,
  },
  {
    key: 'sophia',
    label: 'Sophia',
    figureAsset: 'figure_sophia',
    orbAsset: 'orb_sophia',
    ring: 'inner',
    angle: -Math.PI / 2, // 12 o'clock — anchor
    breathPhase: 0.6,
    // Sophia 82.7% canvas-fill → 1.7 / 0.827 ≈ 2.05
    figScale: 2.05,
    figOffsetYPct: 0.0,
  },
  {
    key: 'vishnu',
    label: 'Vishnu',
    figureAsset: 'figure_vishnu',
    orbAsset: 'orb_vishnu',
    ring: 'inner',
    angle: -Math.PI / 2 - 2 * Math.PI * 4 / 5, // upper-right (was -π/6)
    breathPhase: 2.4,
    // Vishnu 86.9% canvas-fill → 1.7 / 0.869 ≈ 1.96
    figScale: 1.96,
    figOffsetYPct: 0.02,
  },
  {
    key: 'nuwa',
    label: 'Nüwa',
    figureAsset: 'figure_nuwa',
    orbAsset: 'orb_nuwa',
    ring: 'inner',
    angle: -Math.PI / 2 - 2 * Math.PI * 3 / 5, // lower-right (was π/6)
    breathPhase: 3.8,
    // Nüwa 86.0% canvas-fill → 1.7 / 0.860 ≈ 1.98
    figScale: 1.98,
    figOffsetYPct: 0.02,
  },
  // ----- Outer ring (radius 0.50) — 8 figures spaced π/4 -----
  // Outer-ring angle pattern: -π/2 - 2π × k / 8 for k=0..7 going CCW from 12.
  {
    key: 'buddha',
    label: 'Buddha',
    figureAsset: 'figure_buddha',
    orbAsset: 'orb_buddha',
    ring: 'outer',
    angle: -Math.PI / 2, // k=0, 12 o'clock — directly above Sophia
    breathPhase: 1.2,
    // Buddha 87.3% canvas-fill → 1.7 / 0.873 ≈ 1.95
    figScale: 1.95,
    figOffsetYPct: 0.03,
  },
  {
    key: 'sita',
    label: 'Sita',
    figureAsset: 'figure_sita',
    orbAsset: 'orb_sita',
    ring: 'outer',
    angle: -Math.PI / 2 - 2 * Math.PI * 1 / 8, // k=1, 10:30 — above Inanna (queens rhyme)
    breathPhase: 2.5,
    // Sita 79.3% canvas-fill → 1.7 / 0.793 ≈ 2.14
    figScale: 2.14,
    figOffsetYPct: 0.02,
  },
  {
    key: 'socrates',
    label: 'Socrates',
    figureAsset: 'figure_socrates',
    orbAsset: 'orb_socrates',
    ring: 'outer',
    angle: -Math.PI / 2 - 2 * Math.PI * 7 / 8, // k=7, 1:30 — above Vishnu (wisdom rhymes Buddha)
    breathPhase: 0.4,
    // Socrates 79.2% canvas-fill → 1.7 / 0.792 ≈ 2.15
    figScale: 2.15,
    figOffsetYPct: 0.02,
  },
  {
    key: 'demeter_persephone',
    label: 'Demeter & Persephone',
    figureAsset: 'figure_demeter_persephone',
    orbAsset: 'orb_demeter_persephone',
    ring: 'outer',
    angle: -Math.PI / 2 - 2 * Math.PI * 2 / 8, // k=2, 9 o'clock — above Osiris (death/rebirth rhyme)
    breathPhase: 1.7,
    // Demeter+Persephone 90.4% canvas-fill → 1.7 / 0.904 ≈ 1.88
    figScale: 1.88,
    figOffsetYPct: 0.02,
  },
  {
    key: 'abraham_sarah',
    label: 'Abraham & Sarah',
    figureAsset: 'figure_abraham_sarah',
    orbAsset: 'orb_abraham_sarah',
    ring: 'outer',
    angle: -Math.PI / 2 - 2 * Math.PI * 3 / 8, // k=3, 7:30 — lower-left twin
    breathPhase: 3.0,
    // Abraham+Sarah pair, bbox ≈ 100% wide → figScale 1.7
    figScale: 1.70,
    figOffsetYPct: 0.02,
  },
  {
    key: 'hero_twins',
    label: 'Hunahpú & Xbalanqué',
    figureAsset: 'figure_hero_twins',
    orbAsset: 'orb_hero_twins',
    ring: 'outer',
    angle: -Math.PI / 2 - 2 * Math.PI * 4 / 8, // k=4, 6 o'clock — bottom
    breathPhase: 1.0,
    // Hero Twins v2 (humans) 90.7% canvas-fill → 1.7 / 0.907 ≈ 1.87
    figScale: 1.87,
    figOffsetYPct: 0.02,
  },
  {
    key: 'brigid',
    label: 'Brigid',
    figureAsset: 'figure_brigid',
    orbAsset: 'orb_brigid',
    ring: 'outer',
    angle: -Math.PI / 2 - 2 * Math.PI * 5 / 8, // k=5, 4:30 — above Nüwa (creator-goddess rhyme)
    breathPhase: 2.1,
    // Brigid v2 89.3% canvas-fill → 1.7 / 0.893 ≈ 1.90
    figScale: 1.90,
    figOffsetYPct: 0.02,
  },
  {
    key: 'zoroaster',
    label: 'Zoroaster',
    figureAsset: 'figure_zoroaster',
    orbAsset: 'orb_zoroaster',
    ring: 'outer',
    angle: -Math.PI / 2 - 2 * Math.PI * 6 / 8, // k=6, 3 o'clock — above Vishnu (cosmic order)
    breathPhase: 0.8,
    // Zoroaster 92.5% canvas-fill → 1.7 / 0.925 ≈ 1.84
    figScale: 1.84,
    figOffsetYPct: 0.02,
  },
];

// Orb diameter as a fraction of cosmos min-dimension.
// 13 orbs (5 inner + 8 outer) need to sit on rings without overlapping.
// Outer ring (8 orbs at radius 0.50): circumference ≈ π; per-orb arc ≈ π/8.
// Chord length at that arc ≈ 0.39 ring-radius units ≈ 0.20 cosmos units, so
// orb diameters up to ~0.13 give comfortable spacing on both rings.
const ORB_SIZE_PCT = 0.11;

// Display name for the central star. Pulled out as a single config so it can
// be swapped later without touching the hover/label rendering. Set to null or
// empty string to suppress the label entirely (e.g. if the central star is
// ever meant to remain unnamed at certain stages of the experience).
const LOGOS_LABEL = 'Logos';

// Draw a single orb at (ox, oy) with radius r.
// The orb shell is a pre-painted oil sprite (transparent outside the circle).
// The figure is a separate sprite that sits inside, clipped to the orb.
// On top: a soft catch-light pinpoint to sell the glass.
//
// Layers, back to front:
//   1. Soft outer halo bleed into the surrounding cosmos
//   2. Pre-painted orb shell sprite (oil-painted cosmos in a glass bubble)
//   3. Figure sprite, clipped to the orb circle
//   4. Upper-left catch-light pinpoint (subtle — the shell already has one)
function drawOrb(ox, oy, r, figureImg, orbImg, fig, t) {
  // ---- 1. Faint outer halo bleed ----
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const haloR = r * 1.4;
  const haloGrad = ctx.createRadialGradient(ox, oy, r * 0.92, ox, oy, haloR);
  haloGrad.addColorStop(0, 'rgba(255, 215, 150, 0.14)');
  haloGrad.addColorStop(1, 'rgba(255, 215, 150, 0)');
  ctx.fillStyle = haloGrad;
  ctx.beginPath();
  ctx.arc(ox, oy, haloR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Per-figure breath: gentle scale + alpha pulse, ~10s cycle.
  const breathPhase = (fig && fig.breathPhase) || 0;
  const breath = Math.sin(t * 0.00063 + breathPhase);
  const breathScale = 1 + breath * 0.018;
  const drawR = r * breathScale;

  // ---- 2. Orb shell sprite (oil-painted cosmos + gold rim) ----
  // The shell sprite is pre-cropped to a transparent circle. We just draw it
  // at the right size centered on (ox, oy).
  const shellSize = drawR * 2;
  ctx.drawImage(orbImg, ox - drawR, oy - drawR, shellSize, shellSize);

  // ---- 3. Figure, clipped to the orb circle ----
  // Figure is sized to fit inside the orb interior (slightly smaller than the
  // gold rim) and positioned a touch low so a seated body sits on the bottom
  // half of the bubble like the reference.
  ctx.save();
  ctx.beginPath();
  ctx.arc(ox, oy, drawR * 0.92, 0, Math.PI * 2);
  ctx.clip();
  const figScale = (fig && fig.figScale) || 1.7;
  const figOffsetYPct = (fig && fig.figOffsetYPct) != null ? fig.figOffsetYPct : 0.05;
  const figSize = drawR * figScale;
  const figOffsetY = drawR * figOffsetYPct;
  ctx.drawImage(
    figureImg,
    ox - figSize / 2,
    oy - figSize / 2 + figOffsetY,
    figSize,
    figSize
  );
  ctx.restore();

  // ---- 4. Catch-light pinpoint on top of figure ----
  // The shell already has a painted catch-light, but adding a tiny live one on
  // top of the figure preserves the "glass over body" feel.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const specAngle = Math.PI * 1.22; // upper-left
  const specCenterX = ox + Math.cos(specAngle) * drawR * 0.6;
  const specCenterY = oy + Math.sin(specAngle) * drawR * 0.6;
  const specR = drawR * 0.18;
  const specGrad = ctx.createRadialGradient(
    specCenterX, specCenterY, 0,
    specCenterX, specCenterY, specR
  );
  const specA = 0.35 + breath * 0.08;
  specGrad.addColorStop(0, `rgba(255, 252, 235, ${specA})`);
  specGrad.addColorStop(0.5, `rgba(255, 245, 215, ${specA * 0.4})`);
  specGrad.addColorStop(1, 'rgba(255, 245, 215, 0)');
  ctx.fillStyle = specGrad;
  ctx.beginPath();
  ctx.arc(specCenterX, specCenterY, specR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Per-frame record of where each orb landed on screen (CSS pixels).
// Used for hover hit-testing in drawHoverLabel — must be populated by drawOrbs
// each frame before drawHoverLabel is called.
const orbHits = [];
// Smoothed hover-alpha per figure key. 0 = label hidden, 1 = fully visible.
// Eased every frame toward the target (1 if hovered, 0 if not) for soft fade.
const hoverAlpha = Object.create(null);
// Currently hovered figure key, or null. Computed each frame from pointer +
// orbHits; used to drive hoverAlpha targets and the cursor style.
let hoveredKey = null;
// Logos has its own hover state — kept separate from orb hits so the central
// star can grow on hover without producing a name label or interfering with
// ring-orb hit-testing. logosHit is the recorded hit zone (CSS pixels), set
// each frame inside drawLogos. logosHoverAlpha eases 0..1 the same way as the
// orb hover alphas.
let logosHit = null;
let logosHoverAlpha = 0;
let logosHovered = false;

function drawOrbs(cosmosRect, t) {
  const { cx, cy, cw, ch } = cosmosRect;
  const centerX = cx + cw / 2;
  const centerY = cy + ch / 2;

  // Match ring geometry from drawRings — keep these in sync.
  const baseR = Math.min(cw, ch);
  const innerR = baseR * 0.30;
  const outerR = baseR * 0.50;
  const tilt = 0.55;

  // Orbs feel mid-depth — between rings (18/12) and Logos (22/16).
  const parallaxX = mx * 20;
  const parallaxY = my * 14;

  // Orbital sweep around the central Logos. Direction matches the gas
  // (positive = same as gas swirl), so the orbs feel tied to the cosmos
  // rather than the distant starfield. Outer ring rotates at half the inner
  // angular rate — closer to real orbital mechanics (further bodies orbit
  // slower) and visually calmer since outer orbs travel a longer arc per
  // unit angle. Inner: ~3.6 min per turn (slowed 20% from 0.000035); outer: ~6 min per turn.
  const innerOrbitOffset = t * 0.000028;
  const outerOrbitOffset = t * 0.0000175;

  // Reset hit list for this frame before redrawing orbs.
  orbHits.length = 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(cx, cy, cw, ch);
  ctx.clip();

  for (const fig of FIGURES) {
    const figImg = assets[fig.figureAsset];
    const orbImg = assets[fig.orbAsset];
    if (!figImg || !figImg.complete) continue;
    if (!orbImg || !orbImg.complete) continue;

    // Start-sequence visibility: until the player has progressed past the
    // initial pick, only the chosen Dawn star renders. All other inner-ring
    // stars stay hidden (the spec calls for staggered cinematic reveals as
    // the chosen star reaches Bright). Outer-ring (Ancient) figures stay
    // hidden until all five Dawn stars unlock.
    if (window.chosenStartStar) {
      if (fig.ring === 'inner' && fig.key !== window.chosenStartStar) continue;
      if (fig.ring === 'outer') continue;
    }

    const ringR = fig.ring === 'inner' ? innerR : outerR;
    const ringOrbit = fig.ring === 'inner' ? innerOrbitOffset : outerOrbitOffset;
    const a = fig.angle + ringOrbit;
    const orbX = centerX + Math.cos(a) * ringR + parallaxX;
    const orbY = centerY + Math.sin(a) * ringR * tilt + parallaxY;

    // Baseline orbs sit at 88% of full size so the central Logos dominates.
    // On hover, the orb eases back to 100% — hoverAlpha (0..1) drives the
    // grow, smoothed each frame in updateHover() for a soft pop-out.
    const baseOrbR = baseR * ORB_SIZE_PCT * 0.5;
    const hAlpha = hoverAlpha[fig.key] || 0;
    const hoverScale = 0.88 + hAlpha * 0.12;
    const orbR = baseOrbR * hoverScale;
    drawOrb(orbX, orbY, orbR, figImg, orbImg, fig, t);

    // Record this orb's screen-space hit circle for the hover pass. Use the
    // CURRENT (scaled) radius so the hit zone tracks what the user actually
    // sees — prevents flicker at the boundary as the orb grows.
    orbHits.push({ fig, x: orbX, y: orbY, r: orbR });
  }

  ctx.restore();
}

// Hit-test the pointer against the recorded orbs and ease per-orb hover alpha
// toward its target. Sets hoveredKey for cursor styling.
function updateHover() {
  let nearestKey = null;
  // Walk in reverse so later (visually-on-top) orbs win ties.
  for (let i = orbHits.length - 1; i >= 0; i--) {
    const h = orbHits[i];
    const dx = pointerX - h.x;
    const dy = pointerY - h.y;
    // Slightly generous hit radius (1.05x) so the edge of the gold rim still counts.
    if (dx * dx + dy * dy <= (h.r * 1.05) * (h.r * 1.05)) {
      nearestKey = h.fig.key;
      break;
    }
  }
  hoveredKey = nearestKey;

  // Ease every figure's hover alpha toward its target. Easing factor tuned for
  // a soft ~200ms fade at 60fps without feeling laggy.
  const ease = 0.12;
  for (const h of orbHits) {
    const target = h.fig.key === nearestKey ? 1 : 0;
    const cur = hoverAlpha[h.fig.key] || 0;
    hoverAlpha[h.fig.key] = cur + (target - cur) * ease;
  }

  // Hit-test the Logos (only if no orb is already hovered — ring orbs win
  // tie-breaks since they're visually on top of the Logos's halo).
  logosHovered = false;
  if (logosHit && !nearestKey) {
    const ldx = pointerX - logosHit.x;
    const ldy = pointerY - logosHit.y;
    if (ldx * ldx + ldy * ldy <= logosHit.r * logosHit.r) {
      logosHovered = true;
    }
  }
  const logosTarget = logosHovered ? 1 : 0;
  logosHoverAlpha = logosHoverAlpha + (logosTarget - logosHoverAlpha) * ease;
}

// Draw a single floating name pill above a circular target. Shared between
// ring-orb labels and the central Logos label so both feel identical.
//   targetX, targetY, targetR: the orb/star center and visual radius.
//   label: text to render; alpha: 0..1 fade.
//   cosmosRect: used to horizontally clamp the pill so long names never spill
//   onto the wood frame.
function drawLabelPill(label, targetX, targetY, targetR, alpha, cosmosRect, fontSize) {
  const { cx, cw } = cosmosRect;

  // Place label just above the target's rim.
  const labelY = targetY - targetR - fontSize * 0.9;
  let labelX = targetX;

  // Measure to build the pill background and clamp X so the pill stays inside cosmos rect.
  const textW = ctx.measureText(label).width;
  const padX = fontSize * 0.7;
  const padY = fontSize * 0.35;
  const pillW = textW + padX * 2;
  const pillH = fontSize + padY * 2;
  const halfW = pillW / 2;
  const margin = 6;
  if (labelX - halfW < cx + margin) labelX = cx + margin + halfW;
  if (labelX + halfW > cx + cw - margin) labelX = cx + cw - margin - halfW;

  // Pill background — warm dark with a hairline gold edge to rhyme with the rings.
  const top = labelY - pillH / 2;
  const radius = pillH / 2;
  ctx.beginPath();
  ctx.moveTo(labelX - halfW + radius, top);
  ctx.lineTo(labelX + halfW - radius, top);
  ctx.arc(labelX + halfW - radius, top + radius, radius, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(labelX - halfW + radius, top + pillH);
  ctx.arc(labelX - halfW + radius, top + radius, radius, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();

  ctx.fillStyle = `rgba(18, 14, 10, ${0.78 * alpha})`;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(232, 196, 128, ${0.55 * alpha})`;
  ctx.stroke();

  // Text — warm cream.
  ctx.fillStyle = `rgba(248, 232, 198, ${0.98 * alpha})`;
  ctx.fillText(label, labelX, labelY);
}

// Render the floating name label above each orb (and the central Logos), at
// the current hover alpha. Drawn AFTER drawOrbs and AFTER the frame so labels
// sit above everything. Labels are clamped horizontally inside the cosmos
// rect so long pair-names never get clipped by the frame.
function drawHoverLabels(cosmosRect) {
  const { cw, ch } = cosmosRect;

  ctx.save();
  // Use a clean, wide-tracked sans for the labels — small caps feel.
  const fontSize = Math.max(13, Math.min(cw, ch) * 0.018);
  ctx.font = `500 ${fontSize}px "Inter", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Ring orbs.
  for (const h of orbHits) {
    const a = hoverAlpha[h.fig.key] || 0;
    if (a < 0.01) continue;
    const label = h.fig.label || h.fig.key;
    drawLabelPill(label, h.x, h.y, h.r, a, cosmosRect, fontSize);
  }

  // Central Logos. Skipped if LOGOS_LABEL is null/empty so we can run unnamed
  // if the design ever calls for it. The label sits closer to the painted disc
  // than its full hit radius would suggest — the painting fades into corona at
  // its edge, so anchoring the pill to ~55% of that radius lets the label feel
  // attached to the star rather than floating off in the corona.
  if (LOGOS_LABEL && logosHit && logosHoverAlpha > 0.01) {
    const labelR = logosHit.r * 0.55;
    drawLabelPill(LOGOS_LABEL, logosHit.x, logosHit.y, labelR, logosHoverAlpha, cosmosRect, fontSize);
  }

  ctx.restore();
}

// ===== Layer: Logos with halo =====
// The Logos is the visual anchor of the cosmos — it must read as the brightest,
// largest, most alive thing on the canvas. Layered light strategy, back to front:
//   1. Wide atmospheric halo (warm glow bleeding into surrounding gas)
//   2. Mid corona (richer warm field around the painting)
//   3. Slowly rotating godrays (4-arm cross + 4-arm diagonal, anisotropic light)
//   4. The Logos painting itself (normal blend, painted detail visible)
//   5. Inner core hotspot (additive, sells "this is where light comes from")
//   6. Rim glow at the edge of the painting
// Two breath waves at different frequencies so the pulse never feels mechanical.
function drawLogos(cosmosRect, t) {
  const { cx, cy, cw, ch } = cosmosRect;
  const centerX = cx + cw / 2;
  const centerY = cy + ch / 2;

  const parallaxX = mx * 22;
  const parallaxY = my * 16;

  // Two breath waves: primary slow heartbeat + secondary slower swell. Combining
  // them keeps the pulse from reading as a single repeating sine.
  const breathSin = Math.sin(t * 0.0006);          // ~10s period
  const breathSlow = Math.sin(t * 0.00023 + 1.1);  // ~27s period
  const pulse = breathSin * 0.6 + breathSlow * 0.4; // -1..1 combined
  const breathScale = 1 + pulse * 0.03;
  const breathAlpha = 0.94 + pulse * 0.06;

  // Logos size: ~42% of cosmos min-dim (was 35%, briefly tried 50% but that
  // crowded the inner ring and exposed the painting's square edge against the
  // bright corona). 42% lets it dominate without swallowing the inner orbs.
  // On hover the Logos eases up an extra 12% — same grow factor as the orbs,
  // so the central star and ring orbs feel like one consistent system.
  const baseSize = Math.min(cw, ch) * 0.42;
  const hoverScale = 1 + logosHoverAlpha * 0.12;
  const size = baseSize * breathScale * hoverScale;

  // Record the Logos hit zone for updateHover(). Use the painting's circular
  // clip radius (size * 0.50) so the hit area matches what the user sees as
  // the painted disc — not the wider corona/halo.
  logosHit = { x: cx + cw / 2 + mx * 22, y: cy + ch / 2 + my * 16, r: size * 0.50 };

  const px = centerX + parallaxX;
  const py = centerY + parallaxY;

  ctx.save();
  // Clip everything to cosmos rect so halo doesn't spill onto frame
  ctx.beginPath();
  ctx.rect(cx, cy, cw, ch);
  ctx.clip();

  // ---- 1. Outer atmospheric halo (widest, gentlest) ----
  // Wide warm glow that bleeds into the surrounding gas. Pulses with the
  // combined breath. Gradient inner radius starts at 0.7×size so the brightest
  // additive zone sits OUTSIDE the painting — prevents the painting's square
  // PNG edge from being lit up by the corona.
  ctx.globalCompositeOperation = 'lighter';
  const haloR = size * 1.7 * (1 + pulse * 0.06);
  const haloGrad = ctx.createRadialGradient(px, py, size * 0.7, px, py, haloR);
  const haloAlpha = 0.14 + pulse * 0.04;
  haloGrad.addColorStop(0, `rgba(255, 215, 140, ${haloAlpha})`);
  haloGrad.addColorStop(0.5, `rgba(240, 175, 85, ${haloAlpha * 0.4})`);
  haloGrad.addColorStop(1, 'rgba(255, 200, 100, 0)');
  ctx.fillStyle = haloGrad;
  ctx.beginPath();
  ctx.arc(px, py, haloR, 0, Math.PI * 2);
  ctx.fill();

  // ---- 2. Mid corona (just outside the painting circle) ----
  // Inner radius starts at 0.5×size so the corona only exists outside the
  // visible painting, never lighting up the square PNG corners. This was the
  // main failure mode of the first bigger-Logos pass.
  const coronaR = size * 0.95 * (1 + pulse * 0.03);
  const coronaGrad = ctx.createRadialGradient(px, py, size * 0.50, px, py, coronaR);
  const coronaAlpha = 0.12 + pulse * 0.03;
  coronaGrad.addColorStop(0, `rgba(255, 230, 170, ${coronaAlpha})`);
  coronaGrad.addColorStop(1, 'rgba(255, 210, 130, 0)');
  ctx.fillStyle = coronaGrad;
  ctx.beginPath();
  ctx.arc(px, py, coronaR, 0, Math.PI * 2);
  ctx.fill();

  // ---- 3. Slowly rotating godrays (8-arm star burst) ----
  // Long anisotropic light spokes. 4 cardinal arms + 4 diagonal arms at half
  // intensity gives the classic "sacred sun" radiance without looking like a
  // Photoshop lens-flare. Rotation is very slow so it reads as celestial drift,
  // not animation. The arms pulse in alpha with the primary breath so the
  // brightest moment lands on the heartbeat.
  const rayRotation = t * 0.000012; // very slow
  const rayPulse = Math.max(0, breathSin) * 0.5 + 0.5; // 0.5..1
  const rayLen = size * 1.4;
  const rayWidth = size * 0.045;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(rayRotation);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const isCardinal = i % 2 === 0;
    const armAlpha = (isCardinal ? 0.13 : 0.06) * rayPulse;
    const armLen = rayLen * (isCardinal ? 1.0 : 0.78);
    const armWidth = rayWidth * (isCardinal ? 1.0 : 0.7);
    ctx.save();
    ctx.rotate(angle);
    // Linear gradient along the ray, fading from warm gold near the core to
    // transparent at the tip. Width fades too via the radialGradient "feathering"
    // — we approximate with two stacked thin gradients.
    const rayGrad = ctx.createLinearGradient(0, 0, armLen, 0);
    rayGrad.addColorStop(0, `rgba(255, 235, 180, 0)`);
    rayGrad.addColorStop(0.15, `rgba(255, 230, 160, ${armAlpha})`);
    rayGrad.addColorStop(0.4, `rgba(255, 215, 130, ${armAlpha * 0.6})`);
    rayGrad.addColorStop(1, `rgba(255, 200, 100, 0)`);
    ctx.fillStyle = rayGrad;
    // Soft tapered triangle: rectangle with feathered y via per-pixel alpha is
    // expensive; instead draw a thin diamond shape that's wide near the core
    // and tapers to a point.
    ctx.beginPath();
    ctx.moveTo(0, -armWidth);
    ctx.lineTo(armLen, 0);
    ctx.lineTo(0, armWidth);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // ---- 4. Logos painting itself (on top, normal blend so detail is visible) ----
  // CIRCULAR CLIP: the painting PNG is square; without a clip its corners show
  // up against the corona as a hard rectangle (caught in QA). Clip to a circle
  // at 0.5×size so only the round painted disc is visible.
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = breathAlpha;
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, size * 0.50, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(
    assets.logos,
    px - size / 2,
    py - size / 2,
    size,
    size
  );
  ctx.restore();

  // ---- 4b. Opaque white-hot disc to mask the painting's dark center ----
  // The Logos painting has a small dark detail at its core that reads as a
  // black spot. Paint a solid hot disc on top with source-over so the dark
  // pixels are fully replaced, then layer the additive corona over it for life.
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const maskR = size * 0.20;
  const maskGrad = ctx.createRadialGradient(px, py, 0, px, py, maskR);
  maskGrad.addColorStop(0,    'rgba(255, 250, 225, 1)');
  maskGrad.addColorStop(0.55, 'rgba(255, 240, 195, 0.95)');
  maskGrad.addColorStop(0.85, 'rgba(255, 225, 160, 0.45)');
  maskGrad.addColorStop(1,    'rgba(255, 220, 140, 0)');
  ctx.fillStyle = maskGrad;
  ctx.beginPath();
  ctx.arc(px, py, maskR, 0, Math.PI * 2);
  ctx.fill();

  // ---- 5. Inner core hotspot ----
  // Bright additive blob right at the center of the painting. This is what
  // sells "there's a light source inside this thing." Pulses harder than the
  // outer layers so the core feels alive while the corona stays gentle.
  // The core is also wide + bright enough to mask the painting's small dark
  // central detail — the bare painting reads as having a black spot at center,
  // so we burn it out with light.
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'lighter';
  const corePulse = breathSin * 0.5 + 0.5; // 0..1
  const coreR = size * 0.32 * (1 + breathSin * 0.05);
  const coreGrad = ctx.createRadialGradient(px, py, 0, px, py, coreR);
  const coreAlpha = 0.55 + corePulse * 0.15;
  coreGrad.addColorStop(0,    `rgba(255, 252, 235, ${coreAlpha})`);
  coreGrad.addColorStop(0.35, `rgba(255, 240, 190, ${coreAlpha * 0.6})`);
  coreGrad.addColorStop(0.7,  `rgba(255, 220, 140, ${coreAlpha * 0.2})`);
  coreGrad.addColorStop(1,    'rgba(255, 220, 140, 0)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(px, py, coreR, 0, Math.PI * 2);
  ctx.fill();

  // ---- 6. Rim glow at edge of painting ----
  // Tiny additive ring right at the edge of the Logos that pulses with breath.
  // Adds a feeling of light spilling out without erasing the painting.
  const rimR = size * 0.55 * (1 + breathSin * 0.03);
  const rimGrad = ctx.createRadialGradient(px, py, size * 0.35, px, py, rimR);
  const rimAlpha = 0.13 + pulse * 0.05;
  rimGrad.addColorStop(0, 'rgba(255, 240, 200, 0)');
  rimGrad.addColorStop(0.7, `rgba(255, 235, 180, ${rimAlpha})`);
  rimGrad.addColorStop(1, 'rgba(255, 220, 140, 0)');
  ctx.fillStyle = rimGrad;
  ctx.beginPath();
  ctx.arc(px, py, rimR, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ===== Frame & vignette =====
function drawFrame() {
  const { fx, fy, fw, fh } = getFrameRect();
  ctx.drawImage(assets.frame, fx, fy, fw, fh);
}

function drawWallFallback(frameRect) {
  // Only draw the wall when the frame is NOT filling the viewport edge-to-edge.
  if (frameRect.mode === 'edge-to-edge') return;

  // Soft warm "gallery wall" — not pure black, slight dark indigo for warmth.
  // Filled behind the frame; the canvas was already cleared to #0a0a0c, but
  // this gives the wall a richer character on ultrawides.
  const wallGrad = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.25,
    W / 2, H / 2, Math.max(W, H) * 0.75
  );
  wallGrad.addColorStop(0, '#1a1a1f');
  wallGrad.addColorStop(1, '#08080a');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, W, H);
}

// ===== Sanctum scene =====
// Sanctum lookup keyed by FIGURES.key. Each sanctum is a multi-layer stage:
//   bg           : background painting, no figure baked in (cover-fit viewport)
//   spriteKey    : asset key for the figure sprite (transparent)
//   portalKey    : asset key for the portal ring
//   pillarUnlit  : asset key for the dormant answer-pillar
//   pillarLit    : asset key for the lit (chosen) answer-pillar
//   prompt       : the question shown in inscription mode
//   answers      : array { glyph, label, correct } — glyph is just the visual
//                  label on the pillar's call-out subtitle for now (the carved
//                  glyph itself is the painted asset). label is the human text
//                  shown beneath each pillar.
// Add an entry here when a new sanctum ships — no other code changes needed.
const SANCTUMS = {
  inanna: {
    bg: 'sanctum_inanna_bg',
    spriteKey: 'figure_inanna_sanctum',
    gateKey: 'stargate_inanna',
    portalKey: 'portal_interior_inanna',
    label: 'Sanctum of Inanna',
    prompt: 'In my descent, I was stripped of all my gifts at seven gates.\nWhat did I find when I had nothing left?',
    answers: [
      { label: 'The dark', correct: false },
      { label: 'Myself', correct: true },
      { label: 'The way home', correct: false },
    ],
  },
  osiris: {
    bg: 'sanctum_osiris_bg',
    spriteKey: 'figure_osiris_sanctum',
    gateKey: 'stargate_osiris',
    label: 'Sanctum of Osiris',
    prompt: 'I was killed and torn into fourteen pieces, then made whole again.\nWhat is the gift of being broken?',
    answers: [
      { label: 'Mercy', correct: true },
      { label: 'Power', correct: false },
      { label: 'Silence', correct: false },
    ],
  },
  sophia: {
    bg: 'sanctum_sophia_bg',
    spriteKey: 'figure_sophia_sanctum',
    gateKey: 'stargate_sophia',
    label: 'Sanctum of Sophia',
    prompt: 'I am the wisdom that calls aloud in the streets.\nWhat must you set down to hear me?',
    answers: [
      { label: 'Certainty', correct: true },
      { label: 'Hope', correct: false },
      { label: 'Memory', correct: false },
    ],
  },
  vishnu: {
    bg: 'sanctum_vishnu_bg',
    spriteKey: 'figure_vishnu_sanctum',
    gateKey: 'stargate_vishnu',
    label: 'Sanctum of Vishnu',
    prompt: 'In every age I take a new form to preserve what is dear.\nWhat does the world most need preserved?',
    answers: [
      { label: 'Beauty', correct: false },
      { label: 'Dharma', correct: true },
      { label: 'Wonder', correct: false },
    ],
  },
  nuwa: {
    bg: 'sanctum_nuwa_bg',
    spriteKey: 'figure_nuwa_sanctum',
    gateKey: 'stargate_nuwa',
    label: 'Sanctum of Nüwa',
    prompt: 'I patched the cracked sky with five colored stones and made humans from yellow clay.\nWhat is mended by your hands?',
    answers: [
      { label: 'The world', correct: false },
      { label: 'My kin', correct: true },
      { label: 'Myself', correct: false },
    ],
  },
  logos: {
    bg: 'sanctum_logos_bg',
    spriteKey: 'figure_logos_sanctum',
    gateKey: 'stargate_logos',
    label: 'Sanctum of the Logos',
    prompt: 'I am the word at the center of all things — present before the first cosmos and after the last.\nWhat does it mean to be made in my image?',
    answers: [
      { label: 'To create', correct: true },
      { label: 'To rule', correct: false },
      { label: 'To remember', correct: false },
    ],
  },
  buddha: {
    bg: 'sanctum_buddha_bg',
    spriteKey: 'figure_buddha_sanctum',
    gateKey: 'stargate_buddha',
    label: 'Sanctum of the Buddha',
    prompt: 'I left a palace of every comfort and sat under the bodhi tree until I saw clearly.\nWhat is the first noble truth I found?',
    answers: [
      { label: 'Life is suffering', correct: true },
      { label: 'Life is illusion', correct: false },
      { label: 'Life is a test', correct: false },
    ],
  },
  sita: {
    bg: 'sanctum_sita_bg',
    spriteKey: 'figure_sita_sanctum',
    gateKey: 'stargate_sita',
    label: 'Sanctum of Sita',
    prompt: 'I was carried across the ocean by a demon king, yet I never bent toward him.\nWhat held me steady through every season of exile?',
    answers: [
      { label: 'Devotion', correct: true },
      { label: 'Pride', correct: false },
      { label: 'Fear', correct: false },
    ],
  },
  demeter_persephone: {
    bg: 'sanctum_demeter_persephone_bg',
    spriteKey: 'figure_demeter_persephone_sanctum',
    gateKey: 'stargate_demeter_persephone',
    label: 'Sanctum of Demeter and Persephone',
    prompt: 'My daughter was taken into the dark and I let the fields go barren until she returned.\nWhat does the world learn from our parting and our reunion?',
    answers: [
      { label: 'The seasons', correct: true },
      { label: 'The stars', correct: false },
      { label: 'The tides', correct: false },
    ],
  },
  abraham_sarah: {
    bg: 'sanctum_abraham_sarah_bg',
    spriteKey: 'figure_abraham_sarah_sanctum',
    gateKey: 'stargate_abraham_sarah',
    label: 'Sanctum of Abraham and Sarah',
    prompt: 'We left our father’s house and walked into a country we had never seen.\nWhat was promised to us under that wide field of stars?',
    answers: [
      { label: 'A people', correct: true },
      { label: 'A throne', correct: false },
      { label: 'A weapon', correct: false },
    ],
  },
  hero_twins: {
    bg: 'sanctum_hero_twins_bg',
    spriteKey: 'figure_hero_twins_sanctum',
    gateKey: 'stargate_hero_twins',
    label: 'Sanctum of the Hero Twins',
    prompt: 'We descended into Xibalba, played the lords of death at their own ballgame, and rose again as sun and moon.\nWhat did we trade to make that climb?',
    answers: [
      { label: 'Our deaths', correct: true },
      { label: 'Our names', correct: false },
      { label: 'Our brother', correct: false },
    ],
  },
  brigid: {
    bg: 'sanctum_brigid_bg',
    spriteKey: 'figure_brigid_sanctum',
    gateKey: 'stargate_brigid',
    label: 'Sanctum of Brigid',
    prompt: 'I keep a flame in one hand and point to a well with the other.\nWhat do fire and water together teach the one who tends them?',
    answers: [
      { label: 'Healing', correct: true },
      { label: 'War', correct: false },
      { label: 'Silence', correct: false },
    ],
  },
  zoroaster: {
    bg: 'sanctum_zoroaster_bg',
    spriteKey: 'figure_zoroaster_sanctum',
    gateKey: 'stargate_zoroaster',
    label: 'Sanctum of Zoroaster',
    prompt: 'I taught that every life is a battlefield between truth and the lie.\nWhich three small things tip the scale toward the light?',
    answers: [
      { label: 'Good thoughts, words, deeds', correct: true },
      { label: 'Wealth, power, fame', correct: false },
      { label: 'Faith, fear, fate', correct: false },
    ],
  },
  socrates: {
    bg: 'sanctum_socrates_bg',
    spriteKey: 'figure_socrates_sanctum',
    gateKey: 'stargate_socrates',
    label: 'Sanctum of Socrates',
    prompt: 'I drank the hemlock rather than stop asking inconvenient questions.\nWhich kind of life did I say is not worth living?',
    answers: [
      { label: 'The unexamined', correct: true },
      { label: 'The unhappy', correct: false },
      { label: 'The unwealthy', correct: false },
    ],
  },
};

// Scene state machine:
//   activeSanctum   : null when in cosmos view; figure.key when in/entering a sanctum.
//   sanctumT        : eased 0..1. 0 = full cosmos, 1 = full sanctum.
//   sanctumTarget   : where sanctumT is heading. Click-orb sets it to 1, ESC to 0.
// Inside a sanctum, a second sub-state controls the lesson stage:
//   lessonPhase     : 'idle' (just sanctum), 'rising' (portal/pillars rising),
//                     'asking' (question shown, pillars listening),
//                     'answered' (one pillar lit, others dimmed)
//   riseT           : 0..1 eased — drives the portal+pillars rise animation
//   chosenIndex     : index into answers[] once the player picks. -1 until then.
let activeSanctum = null;
let sanctumT = 0;
let sanctumTarget = 0;
let lessonPhase = 'idle';
let riseT = 0;
let chosenIndex = -1;

// Hit zones recorded each frame for hit-testing without recomputing layout.
let backHit = null;
let beginHit = null;
let pillarHits = []; // [{x, y, w, h, index}]
let spriteHit = null; // {x, y, w, h} — (deprecated as trigger; left for cursor logic)
let poolHit = null;   // {x, y, w, h} — click the water/pool to summon the gate

// Dust particles kicked up as the stargate rises. Each: {x, y, vx, vy, life, ttl, size, hue}
let dustParticles = [];
let dustEmitterT = 0; // accumulator for emission cadence

// Enter a sanctum by figure key. No-op if no sanctum painting is registered.
function enterSanctum(key) {
  if (!SANCTUMS[key]) return false;
  activeSanctum = key;
  sanctumTarget = 1;
  // Reset lesson state so each entry feels fresh.
  lessonPhase = 'idle';
  riseT = 0;
  chosenIndex = -1;
  // Swap the portal video to the deity's palette. The interior shimmer reads
  // as a different cosmos for each god — lapis for Inanna, amber for Osiris,
  // emerald for Brigid, etc.
  setPortalForDeity(key);
  return true;
}

// Exit back to cosmos. activeSanctum stays set until sanctumT eases back to 0
// so the painting keeps drawing during the fade-out.
function exitSanctum() {
  sanctumTarget = 0;
}

// Begin the lesson — portal and pillars rise from the ground.
function beginLesson() {
  if (lessonPhase !== 'idle') return;
  lessonPhase = 'rising';
  riseT = 0;
}

// Player picks an answer.
function choosePillar(index) {
  if (lessonPhase !== 'asking') return;
  chosenIndex = index;
  lessonPhase = 'answered';
}

// Click handler — routes to enterSanctum if the pointer is over a hoverable
// target, or handles in-sanctum clicks (back chip, begin chip, pillars).
canvas.addEventListener('click', (e) => {
  // Start sequence (title + picker) gets first crack at every click. It
  // returns true once the click is consumed (or to swallow stray clicks on
  // its own screen).
  if (window.gameScreen && window.gameScreen !== 'cosmos') {
    if (window.startSeqHandleClick && window.startSeqHandleClick(e.clientX, e.clientY)) {
      return;
    }
  }
  if (activeSanctum && sanctumT > 0.5) {
    // Inside a sanctum.
    // 1. Back chip always wins.
    if (backHit) {
      const dx = e.clientX - backHit.x;
      const dy = e.clientY - backHit.y;
      if (dx * dx + dy * dy <= backHit.r * backHit.r) {
        exitSanctum();
        return;
      }
    }
    // 2. Click the water/pool (idle phase) → summon the stargate. The pool
    //    is a wide rectangular zone in the lower-center of the bg painting.
    if (lessonPhase === 'idle' && poolHit) {
      if (
        e.clientX >= poolHit.x &&
        e.clientX <= poolHit.x + poolHit.w &&
        e.clientY >= poolHit.y &&
        e.clientY <= poolHit.y + poolHit.h
      ) {
        beginLesson();
        return;
      }
    }
    // 3. Click inside the portal opening (gate fully risen) → advance to
    //    the next slide for this deity. Runs BEFORE pillar hit-detection
    //    because the portal interior covers the entire wormhole circle and
    //    the pillars sit inside it; without precedence, clicks meant for
    //    the portal would land on pillar zones in the lower arc and fire
    //    answer logic instead. Single-slide gods still consume the click
    //    here so it doesn't fall through to anything else.
    if (
      lastGateLayout &&
      lessonPhase !== 'rising' &&
      lastGateLayout.risen > 0.9
    ) {
      const dxg = e.clientX - lastGateLayout.cx;
      const dyg = e.clientY - lastGateLayout.cy;
      if (dxg * dxg + dyg * dyg <= lastGateLayout.innerR * lastGateLayout.innerR) {
        advancePortalSlide();
        return;
      }
    }
    // 4. Pillars (only in asking phase). Pillars sit inside the gate, so this
    //    only runs for clicks that escaped the portal hit-test above — i.e.,
    //    when the gate hasn't risen yet. Effectively dead code now that #3
    //    catches everything inside the gate; left in for future re-enabling.
    if (lessonPhase === 'asking') {
      for (const p of pillarHits) {
        if (
          e.clientX >= p.x &&
          e.clientX <= p.x + p.w &&
          e.clientY >= p.y &&
          e.clientY <= p.y + p.h
        ) {
          choosePillar(p.index);
          return;
        }
      }
    }
    // 5. In answered phase, clicking anywhere resets to idle for re-try.
    if (lessonPhase === 'answered') {
      lessonPhase = 'idle';
      riseT = 0;
      chosenIndex = -1;
      return;
    }
    return;
  }
  // In cosmos: route to whichever orb / Logos is currently hovered.
  // Logos is visible from start but locked until the chosen Dawn star
  // reaches Bright (or 1 Ember spent). For now (no progression yet), block
  // entry whenever a start star has been picked but Logos hasn't unlocked.
  if (hoveredKey) enterSanctum(hoveredKey);
  else if (logosHovered && !window.logosLocked) enterSanctum('logos');
});

// ESC also exits a sanctum. Standard expectation for any zoomed-in view.
window.addEventListener('keydown', (e) => {
  // Start sequence (title + picker) handles arrow keys and Enter/Space.
  if (window.gameScreen && window.gameScreen !== 'cosmos') {
    if (window.startSeqHandleKey && window.startSeqHandleKey(e)) return;
  }
  if (e.key === 'Escape' && activeSanctum) exitSanctum();
});

// Particle types. Three layers stacked for a tomb-awakening feel:
//   'dust'  : fine motes, drift up, gold/tan, fade slow
//   'sand'  : larger heavier grains, ballistic arc, fall back down
//   'gust'  : low-opacity wind streaks blowing left-to-right (or random)
//   'spark' : tiny gold embers near the gate's edge as it surfaces
function spawnDust(cx, baseY, gateW, riseT) {
  // Intensity ramps up at the start, peaks ~25% rise, tapers as gate settles.
  // riseT 0..1. Bell curve: max around riseT=0.25.
  const bell = Math.max(0, 1 - Math.abs(riseT - 0.18) * 2.4);
  const intensity = bell * 1.0; // 0..1
  const spread = gateW * 0.7;

  // Fine dust motes — lots of them.
  const dustN = Math.round(8 + intensity * 22);
  for (let i = 0; i < dustN; i++) {
    const x = cx + (Math.random() - 0.5) * spread * 2;
    const y = baseY + (Math.random() - 0.3) * 18;
    dustParticles.push({
      kind: 'dust',
      x, y,
      vx: (Math.random() - 0.5) * 0.9,
      vy: -0.8 - Math.random() * 2.2,
      life: 0,
      ttl: 1800 + Math.random() * 1600,
      size: 1.0 + Math.random() * 2.4,
      hue: 32 + Math.random() * 18,
    });
  }

  // Heavier sand grains — ballistic, fall back. Spawn fewer but with weight.
  const sandN = Math.round(2 + intensity * 10);
  for (let i = 0; i < sandN; i++) {
    const x = cx + (Math.random() - 0.5) * spread * 1.6;
    const y = baseY + (Math.random() - 0.5) * 8;
    const dir = Math.random() < 0.5 ? -1 : 1;
    dustParticles.push({
      kind: 'sand',
      x, y,
      vx: dir * (1.5 + Math.random() * 3.5),
      vy: -3.5 - Math.random() * 4.5,
      life: 0,
      ttl: 1100 + Math.random() * 700,
      size: 1.4 + Math.random() * 2.0,
      hue: 28 + Math.random() * 10,
      gravity: 0.18,
    });
  }

  // Wind streaks — long horizontal smears that read as a gust.
  if (Math.random() < 0.55 + intensity * 0.4) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    const y = baseY - Math.random() * gateW * 1.1;
    dustParticles.push({
      kind: 'gust',
      x: cx - dir * (gateW * 0.9),
      y,
      vx: dir * (4 + Math.random() * 5),
      vy: -0.4 - Math.random() * 0.8,
      life: 0,
      ttl: 700 + Math.random() * 500,
      size: 28 + Math.random() * 40, // length
      thickness: 1 + Math.random() * 2.2,
      hue: 36 + Math.random() * 14,
    });
  }

  // Gold embers along the gate's emerging top edge — ancient stone waking.
  if (riseT > 0.05 && riseT < 0.95) {
    const sparkN = Math.round(intensity * 4);
    for (let i = 0; i < sparkN; i++) {
      // Sample along the visible top arc of the ring as it rises.
      const angle = Math.PI + (Math.random() - 0.5) * Math.PI * 0.9;
      const r = (gateW / 2) * 0.96;
      const gateCy = baseY - (gateW / 2) * (riseT < 1 ? riseT : 1);
      const x = cx + Math.cos(angle) * r;
      const y = gateCy + Math.sin(angle) * r;
      dustParticles.push({
        kind: 'spark',
        x, y,
        vx: (Math.random() - 0.5) * 0.6,
        vy: -0.6 - Math.random() * 1.0,
        life: 0,
        ttl: 500 + Math.random() * 600,
        size: 0.9 + Math.random() * 1.4,
        hue: 44 + Math.random() * 10,
      });
    }
  }

  // Cap.
  if (dustParticles.length > 1500) dustParticles.splice(0, dustParticles.length - 1500);
}

// Camera shake intensity tied to rise: peaks ~25% then decays.
function shakeOffset(rise, t) {
  if (rise <= 0 || rise >= 1) return { x: 0, y: 0 };
  // Bell curve, max 1.0 at rise~0.2, gone by rise~0.85.
  const env = Math.max(0, 1 - Math.abs(rise - 0.22) * 1.8);
  const amp = env * 6.5; // pixel amplitude
  // Fast jitter.
  const x = (Math.sin(t * 0.043) + Math.sin(t * 0.071) * 0.6) * amp * 0.5;
  const y = (Math.cos(t * 0.039) + Math.cos(t * 0.067) * 0.7) * amp * 0.5;
  return { x, y };
}

function updateAndDrawDust(dt) {
  if (!dustParticles.length) return;
  ctx.save();
  for (let i = dustParticles.length - 1; i >= 0; i--) {
    const p = dustParticles[i];
    p.life += dt;
    if (p.life >= p.ttl) { dustParticles.splice(i, 1); continue; }
    p.x += p.vx;
    p.y += p.vy;
    if (p.kind === 'sand') {
      p.vy += p.gravity || 0.18;
      p.vx *= 0.995;
    } else if (p.kind === 'dust') {
      p.vy *= 0.992;
      p.vx *= 0.98;
      p.vy += 0.004;
    } else if (p.kind === 'gust') {
      p.vx *= 0.992;
    } else if (p.kind === 'spark') {
      p.vy *= 0.97;
      p.vx *= 0.97;
    }
    const lifeT = p.life / p.ttl;
    const fadeIn = lifeT < 0.12 ? lifeT / 0.12 : 1;
    const fadeOut = lifeT > 0.6 ? (1 - lifeT) / 0.4 : 1;
    const alpha = Math.max(0, Math.min(1, fadeIn * fadeOut));

    if (p.kind === 'gust') {
      // Streak: draw a soft elongated horizontal blur.
      const len = p.size;
      const dir = Math.sign(p.vx) || 1;
      const grad = ctx.createLinearGradient(p.x - dir * len, p.y, p.x + dir * len, p.y);
      grad.addColorStop(0, `hsla(${p.hue}, 35%, 75%, 0)`);
      grad.addColorStop(0.5, `hsla(${p.hue}, 35%, 78%, ${alpha * 0.32})`);
      grad.addColorStop(1, `hsla(${p.hue}, 35%, 75%, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(p.x - len, p.y - p.thickness, len * 2, p.thickness * 2);
    } else if (p.kind === 'spark') {
      ctx.fillStyle = `hsla(${p.hue}, 88%, 68%, ${alpha * 0.85})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      // Soft halo.
      ctx.fillStyle = `hsla(${p.hue}, 80%, 60%, ${alpha * 0.25})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const a = p.kind === 'sand' ? alpha * 0.78 : alpha * 0.55;
      const sat = p.kind === 'sand' ? 38 : 45;
      const lit = p.kind === 'sand' ? 60 : 72;
      ctx.fillStyle = `hsla(${p.hue}, ${sat}%, ${lit}%, ${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Cover-fit a 16:9 painting to the full viewport — always fills, may crop.
// Used for sanctum backgrounds.
function drawSanctumPainting(img, alpha) {
  if (!img || !img.naturalWidth) return;
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const viewAspect = W / H;
  let dw, dh, dx, dy;
  if (viewAspect > imgAspect) {
    dw = W;
    dh = W / imgAspect;
    dx = 0;
    dy = (H - dh) / 2;
  } else {
    dh = H;
    dw = H * imgAspect;
    dy = 0;
    dx = (W - dw) / 2;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

// Draw the figure sprite at left-of-center foreground. The sprite has its own
// transparency. We size it to ~62% of viewport height so the figure feels
// human-scale and grounded in the painting.
function drawSanctumSprite(img, alpha) {
  spriteHit = null;
  if (!img || !img.naturalWidth) return;
  const targetH = H * 0.62;
  const targetW = targetH * (img.naturalWidth / img.naturalHeight);
  const cx = W * 0.18;
  const yTop = H - targetH - H * 0.04;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, cx - targetW / 2, yTop, targetW, targetH);
  ctx.restore();
  // Record sprite hit-zone (slightly inset to ignore transparent corners).
  spriteHit = {
    x: cx - targetW * 0.32,
    y: yTop + targetH * 0.02,
    w: targetW * 0.64,
    h: targetH * 0.96,
  };
}

// Smoothstep easing for rise animations — starts and ends gently, real motion
// in the middle. The pillars and portal use this so the rise feels organic.
function smoothstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

// Draw the stargate — a heavy carved stone ring with a luminous wormhole
// surface inside. Rises from below as riseT goes 0→1. Once risen, it acts as
// the lesson canvas: prompt text appears ON the wormhole surface, and answer
// choices appear as glowing zones across that surface.
//
// Returns the gate's screen-space layout (cx, cy, gateRadius, innerRadius) so
// the caller can position prompts and answer hit zones relative to it.
function drawStargate(img, alpha, rise, t) {
  if (!img || !img.naturalWidth) return null;
  // Gate sized to dominate the scene. Centered horizontally.
  const targetH = Math.min(H * 0.78, W * 0.5);
  const targetW = targetH; // square asset
  const cx = W * 0.5;
  const cyFinal = H * 0.50;
  // Rise from below: anchor point is the gate's BOTTOM. As rise increases, the
  // gate's bottom edge stays at the same world Y (sandstone floor) but the
  // gate moves upward into view.
  // Gate's bottom rests at the floor line. The asset itself has its rock
  // foundation cropped off, so we don't need to raise the clip above the lions.
  const baseY = H * 0.92;
  const e = smoothstep(rise);
  // Subtle overshoot for life.
  const overshoot = Math.sin(rise * Math.PI) * 0.02;
  const cy = baseY - (targetH / 2) * (e + overshoot);
  // Inner radius matches the carved ring's transparent hole in the PNG asset.
  // Hole punched at 40% of full width — all the way to the gold inner trim.
  // The painted water texture is gone; the star fills the entire opening,
  // edge to edge against the carved lapis-and-gold ring.
  const innerR = targetW * 0.40;

  // Clip so we only show the gate above the sandstone floor line.
  ctx.save();
  ctx.globalAlpha = alpha * Math.min(1, e * 1.4);
  ctx.beginPath();
  ctx.rect(0, 0, W, baseY);
  ctx.clip();

  // 1) Star fills the wormhole opening (drawn first, behind the ring).
  drawPortalShimmer(cx, cy, innerR, e, t || 0, alpha);

  // 2) Carved-stone ring sits on top, framing the sun.
  ctx.drawImage(img, cx - targetW / 2, cy - targetH / 2, targetW, targetH);

  ctx.restore();

  // Gate inner radius (the wormhole surface) is roughly 38% of gate width.
  // The lesson UI lives inside this circle.
  return {
    cx,
    cy,
    gateR: targetW * 0.5,
    innerR,
    risen: e,
  };
}

// Portal shimmer — the wormhole surface inside the gate ring.
// Reads as a stirred lapis lake with iridescent gold caustics dancing across.
// Built from layered radial gradients + animated noise lobes; cheap, no per-pixel ops.
// Layers (back to front):
//   A. Lapis core: deep indigo→teal radial wash (sets the water mood)
//   B. Iridescent lobes: 3 slow-rotating elliptical gradients (gold/cyan/violet),
//      offset and scaled to feel like light refracting on disturbed water
//   C. Caustic ripples: 4 concentric soft rings expanding outward ("stirred lake")
//   D. Highlight glints: 2 small bright streaks that drift across the surface
function drawPortalShimmer(cx, cy, r, rise, t, alpha) {
  if (rise <= 0.02 || r < 4) return;
  // Fade shimmer in alongside the rise; full strength by the time gate is half-up.
  const reveal = Math.min(1, rise / 0.5);
  const a = alpha * reveal;

  // Slow breath: surface inhales/exhales ~every 3.4s. Pulses brightness + radius wobble.
  const breath = 0.5 + 0.5 * Math.sin(t * 0.00185);
  // Fast vibration ripple on top of breath — makes it feel alive, not lazy.
  const vibe = Math.sin(t * 0.012) * 0.5 + Math.sin(t * 0.0073 + 1.3) * 0.5;

  ctx.save();
  // Clip to the inner circle so the bloom can't bleed onto the carved ring.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // ★ PORTAL INTERIOR — a live cosmic video plays inside the wormhole, framed
  //    by the carved ring. We're already clipped to a circle of radius r, so
  //    the video naturally fills the opening without spilling onto the ring.
  //    Fill void-black first so any dark pixels in the video read as deep space
  //    rather than letting the sanctum bg show through.
  const portalImg = assets.portal_interior_inanna;
  const videoReady = portalVideo && portalVideo.readyState >= 2 && portalVideo.videoWidth > 0;

  if (videoReady) {
    ctx.fillStyle = `rgba(4, 4, 10, ${a})`;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    // Disc fills the inner clip exactly. PNG hole is punched at the same
    // diameter so the carved ring's inner trim frames the video without
    // leaving a black gap or letting the video bleed over the trim.
    const drawSize = r * 2;
    const slowRot = t * 0.00006;
    const pulse = 0.97 + 0.05 * breath;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(slowRot);
    ctx.globalAlpha = a * pulse;
    // Source-over: the video's own colors carry, no screen blend needed since
    // the circular clip handles framing.
    ctx.drawImage(portalVideo, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
    ctx.restore();

    // Warm halo at the inner lip so the live footage reads as cradled by the
    // gold trim instead of a hard cut.
    ctx.globalCompositeOperation = 'screen';
    const halo = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.02);
    halo.addColorStop(0.0, 'rgba(0, 0, 0, 0)');
    halo.addColorStop(0.7, `rgba(255, 200, 120, ${0.08 * a})`);
    halo.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(cx - r * 1.02, cy - r * 1.02, r * 2.04, r * 2.04);
    ctx.globalCompositeOperation = 'source-over';
  } else if (portalImg && portalImg.naturalWidth) {
    // Fallback while video buffers: keep the locked star bitmap so we never
    // show an empty hole.
    ctx.fillStyle = `rgba(8, 6, 14, ${a})`;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const drawSize = r * 2;
    const slowRot = t * 0.00006;
    const pulse = 0.95 + 0.08 * breath;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(slowRot);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = a * pulse;
    ctx.drawImage(portalImg, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  } else {
    // Hard fallback: lapis radial fill.
    const core = ctx.createRadialGradient(cx, cy, r * 0.05, cx, cy, r);
    core.addColorStop(0.0, `rgba(70, 125, 190, ${0.95 * a})`);
    core.addColorStop(0.45, `rgba(28, 70, 130, ${0.92 * a})`);
    core.addColorStop(0.85, `rgba(12, 32, 70, ${0.95 * a})`);
    core.addColorStop(1.0, `rgba(6, 16, 38, ${0.98 * a})`);
    ctx.fillStyle = core;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  ctx.restore();
}

// Render the figure's question ON the wormhole surface, near the top of the
// inner circle. Wraps to fit. Fades in as the gate rises.
function drawPromptOnGate(prompt, gateLayout, alpha, rise) {
  if (!prompt || !gateLayout || rise < 0.4) return;
  const e = (rise - 0.4) / 0.6;
  const fade = Math.min(1, e);
  const fontSize = Math.max(15, Math.min(W, H) * 0.022);
  ctx.save();
  ctx.font = `400 italic ${fontSize}px "Cormorant Garamond", "Iowan Old Style", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = `rgba(0, 0, 0, ${0.85 * fade * alpha})`;
  ctx.shadowBlur = 10;
  ctx.fillStyle = `rgba(255, 240, 200, ${0.97 * fade * alpha})`;
  const lines = prompt.split('\n');
  // Anchor prompt in the upper third of the gate's inner circle.
  const cy = gateLayout.cy - gateLayout.innerR * 0.55;
  const lineH = fontSize * 1.35;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], gateLayout.cx, cy + i * lineH);
  }
  ctx.restore();
}

// Draw answer choices as glowing zones laid out across the lower half of the
// wormhole surface. Each zone is a soft golden disc with the answer label.
// Hovering brightens it; clicking selects.
function drawAnswersOnGate(sanctumDef, gateLayout, alpha, rise) {
  pillarHits = []; // reusing this array as gate-zone hits to keep click handler simple
  if (!gateLayout || (lessonPhase !== 'asking' && lessonPhase !== 'answered')) return;
  const fade = Math.min(1, (rise - 0.55) / 0.45);
  if (fade <= 0) return;

  const answers = sanctumDef.answers;
  const n = answers.length;
  // Lay answers in an arc across the lower half of the inner circle.
  // For 3 answers: angles -30°, 0°, +30° measured down from gate center.
  const arcSpread = (n - 1) * 30 * (Math.PI / 180);
  const radius = gateLayout.innerR * 0.55;
  const fontSize = Math.max(14, Math.min(W, H) * 0.020);
  const zoneR = Math.max(38, gateLayout.innerR * 0.16);

  for (let i = 0; i < n; i++) {
    const tAng = n === 1 ? 0 : -arcSpread / 2 + (i / (n - 1)) * arcSpread;
    // Drop below center: angle from positive Y axis.
    const ax = gateLayout.cx + Math.sin(tAng) * radius;
    const ay = gateLayout.cy + Math.cos(tAng) * radius * 0.85;

    const ans = answers[i];
    const isChosen = lessonPhase === 'answered' && i === chosenIndex;
    const isDimmed = lessonPhase === 'answered' && i !== chosenIndex;

    // Hover brighten.
    const dxp = pointerX - ax;
    const dyp = pointerY - ay;
    const isHover = lessonPhase === 'asking' && (dxp * dxp + dyp * dyp <= zoneR * zoneR);

    // Glowing disc background.
    ctx.save();
    ctx.globalAlpha = alpha * fade * (isDimmed ? 0.4 : 1);
    const grad = ctx.createRadialGradient(ax, ay, 0, ax, ay, zoneR);
    let coreAlpha = isChosen ? 0.85 : isHover ? 0.55 : 0.32;
    grad.addColorStop(0, `rgba(255, 230, 160, ${coreAlpha})`);
    grad.addColorStop(0.6, `rgba(255, 200, 110, ${coreAlpha * 0.4})`);
    grad.addColorStop(1, 'rgba(255, 200, 110, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ax, ay, zoneR, 0, Math.PI * 2);
    ctx.fill();

    // Hairline gold ring around the zone.
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(232, 196, 128, ${(isChosen ? 0.95 : isHover ? 0.75 : 0.55)})`;
    ctx.beginPath();
    ctx.arc(ax, ay, zoneR * 0.85, 0, Math.PI * 2);
    ctx.stroke();

    // Label centered in zone.
    ctx.font = `500 ${fontSize}px "Inter", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = `rgba(0, 0, 0, 0.9)`;
    ctx.shadowBlur = 8;
    ctx.fillStyle = `rgba(248, 232, 198, ${isChosen ? 1 : 0.96})`;
    ctx.fillText(ans.label, ax, ay);
    ctx.restore();

    // Hit zone (circle).
    pillarHits.push({
      x: ax - zoneR,
      y: ay - zoneR,
      w: zoneR * 2,
      h: zoneR * 2,
      index: i,
    });
  }
}

// Feedback line shown after an answer is chosen — a brief response from the
// figure. For now we use a fixed line per answer; later this becomes content.
function drawFeedback(sanctumDef, alpha) {
  if (lessonPhase !== 'answered' || chosenIndex < 0) return;
  const ans = sanctumDef.answers[chosenIndex];
  if (!ans) return;
  const text = ans.correct
    ? '“Yes. When all is taken, what remains is what was always there.”'
    : '“Think again, traveler. Sit with the question.”';
  const fontSize = Math.max(15, Math.min(W, H) * 0.022);
  ctx.save();
  ctx.font = `400 italic ${fontSize}px "Cormorant Garamond", "Iowan Old Style", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = `rgba(0, 0, 0, ${0.75 * alpha})`;
  ctx.shadowBlur = 8;
  ctx.fillStyle = ans.correct
    ? `rgba(255, 232, 168, ${0.97 * alpha})`
    : `rgba(248, 232, 198, ${0.92 * alpha})`;
  ctx.fillText(text, W * 0.58, H * 0.22);
  // Hint: click anywhere to continue.
  ctx.font = `400 ${fontSize * 0.7}px "Inter", sans-serif`;
  ctx.fillStyle = `rgba(232, 196, 128, ${0.6 * alpha})`;
  ctx.fillText('click anywhere to continue', W * 0.58, H * 0.27);
  ctx.restore();
}

// Generic painted-pill button. Draws a centered pill at (anchorX, anchorY) and
// returns its hit-circle for the caller to record.
function drawChip(label, anchorX, anchorY, anchor, alpha) {
  const fontSize = Math.max(13, Math.min(W, H) * 0.018);
  ctx.save();
  ctx.font = `500 ${fontSize}px "Inter", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const textW = ctx.measureText(label).width;
  const padX = fontSize * 0.9;
  const padY = fontSize * 0.5;
  const pillW = textW + padX * 2;
  const pillH = fontSize + padY * 2;
  let pillX = anchorX;
  let pillY = anchorY;
  if (anchor === 'topleft') {
    // anchorX/Y is top-left corner.
  } else if (anchor === 'center') {
    pillX = anchorX - pillW / 2;
    pillY = anchorY - pillH / 2;
  }
  const radius = pillH / 2;

  ctx.beginPath();
  ctx.moveTo(pillX + radius, pillY);
  ctx.lineTo(pillX + pillW - radius, pillY);
  ctx.arc(pillX + pillW - radius, pillY + radius, radius, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(pillX + radius, pillY + pillH);
  ctx.arc(pillX + radius, pillY + radius, radius, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();

  ctx.fillStyle = `rgba(18, 14, 10, ${0.62 * alpha})`;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(232, 196, 128, ${0.55 * alpha})`;
  ctx.stroke();

  ctx.fillStyle = `rgba(248, 232, 198, ${0.96 * alpha})`;
  ctx.fillText(label, pillX + padX, pillY + pillH / 2);
  ctx.restore();

  return {
    x: pillX + pillW / 2,
    y: pillY + pillH / 2,
    r: Math.max(pillW, pillH) / 2 + 4,
  };
}

function drawBackChip(alpha) {
  const pillX = Math.max(20, W * 0.025);
  const pillY = Math.max(20, H * 0.04);
  backHit = drawChip('←  Back to cosmos', pillX, pillY, 'topleft', alpha);
}

function drawBeginChip(alpha) {
  // Centered horizontally, lower portion of screen — invites the player to
  // start the lesson. Hidden once lesson begins.
  beginHit = drawChip('Begin', W * 0.58, H * 0.85, 'center', alpha);
}

// Called by start.js when the player picks their first Dawn star. Locks the
// Logos (visible-but-not-clickable) per spec section 5 layer 4. Once the
// chosen star reaches Bright (or 1 Ember spent), set window.logosLocked = false.
window.onStartStarChosen = function (key) {
  window.logosLocked = true;
  // Hide the bottom hint line if it's still up.
  if (hint) hint.classList.add('fade');
};

// ===== Main loop =====
function start() {
  function loop(t) {
    const ease = 0.06;
    mx += (mxTarget - mx) * ease;
    my += (myTarget - my) * ease;

    // Ease the sanctum transition. When sanctumT lands near 0 with no target,
    // clear activeSanctum so we stop drawing the painting entirely.
    sanctumT += (sanctumTarget - sanctumT) * 0.06;
    if (sanctumTarget === 0 && sanctumT < 0.01) {
      sanctumT = 0;
      activeSanctum = null;
      backHit = null;
      beginHit = null;
      pillarHits = [];
      spriteHit = null;
      poolHit = null;
      dustParticles = [];
    }

    // Slow majestic rise — ancient tomb awakening. Linear-ish so it feels
    // ponderous and heavy rather than springy. ~12 seconds end-to-end.
    if (lessonPhase === 'rising') {
      riseT += 0.0014; // ~12s at 60fps
      if (riseT >= 1) {
        riseT = 1;
        lessonPhase = 'asking';
      }
    }

    const frameRect = getFrameRect();
    const cosmosRect = getCosmosRect(frameRect);

    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    // Start sequence (title + picker) takes the whole canvas before cosmos.
    // Cosmos doesn't render until the player has chosen their first Dawn star.
    if (window.gameScreen && window.gameScreen !== 'cosmos') {
      if (window.startSeqDraw) window.startSeqDraw(t);
      // Cursor for title/picker is set by start.js via a flag.
      canvas.style.cursor = (window.startSeqWantsPointer && window.startSeqWantsPointer(pointerX, pointerY))
        ? 'pointer' : 'default';
      requestAnimationFrame(loop);
      return;
    }

    // Wall fills the surrounding viewport ONLY in framed-on-wall mode
    drawWallFallback(frameRect);

    // Cosmos layers — always drawn, but their visibility fades as we enter a
    // sanctum. Fading the whole cosmos (including frame) gives the sense of
    // leaving the gallery to step into the place.
    const cosmosAlpha = 1 - sanctumT;
    if (cosmosAlpha > 0.005) {
      ctx.save();
      ctx.globalAlpha = cosmosAlpha;
      drawGas(cosmosRect, t);
      drawStars(cosmosRect, t);
      drawRings(cosmosRect, t);
      drawOrbs(cosmosRect, t);
      // Logos is visible from start but visually muted while locked, so the
      // player feels its presence without thinking it's clickable. Spec calls
      // for ~75% intensity until first Dawn star reaches Bright (or 1 Ember).
      if (window.logosLocked) {
        ctx.save();
        ctx.globalAlpha *= 0.75;
        drawLogos(cosmosRect, t);
        ctx.restore();
      } else {
        drawLogos(cosmosRect, t);
      }
      drawFrame();
      ctx.restore();
    }

    // Sanctum stage on top, fading in. Layered render so we can animate pieces:
    //   1. Background painting (no figure baked in)
    //   2. Figure sprite (Inanna, etc.) over the bg
    //   3. Lesson stage: portal rises, pillars rise, prompt fades in
    //   4. Chrome: back chip, begin chip, feedback line
    if (activeSanctum && sanctumT > 0.005) {
      const sanctumDef = SANCTUMS[activeSanctum];
      if (sanctumDef) {
        drawSanctumPainting(assets[sanctumDef.bg], sanctumT);
        drawSanctumSprite(assets[sanctumDef.spriteKey], sanctumT);

        // Register the pool's click zone (matches the painted pool rectangle).
        // Coordinates calibrated against sanctum_inanna_bg.jpg in cover-fit.
        if (lessonPhase === 'idle') {
          poolHit = {
            x: W * 0.27,
            y: H * 0.55,
            w: W * 0.46,
            h: H * 0.23,
          };
        } else {
          poolHit = null;
        }

        // Lesson stage — only visible once we're past 'idle'. The stargate is
        // both stage and screen. Text/answers stripped for now.
        // Camera shake during the rise sells the tomb-awakening drama.
        const shake = (lessonPhase === 'rising' || (lessonPhase === 'asking' && riseT < 0.995))
          ? shakeOffset(riseT, t)
          : { x: 0, y: 0 };
        if (lessonPhase !== 'idle' || riseT > 0) {
          ctx.save();
          ctx.translate(shake.x, shake.y);
          const gateLayout = drawStargate(
            assets[sanctumDef.gateKey],
            sanctumT,
            riseT,
            t
          );
          // Stash the layout for the click handler so it can detect taps
          // inside the portal opening (advance slide).
          lastGateLayout = gateLayout;
          // Emit dust while the gate is rising. Many particles per frame.
          if (lessonPhase === 'rising' && gateLayout) {
            spawnDust(gateLayout.cx, H * 0.92, gateLayout.gateR * 2, riseT);
          }
          ctx.restore();
        } else {
          pillarHits = [];
          lastGateLayout = null;
        }

        // Dust particles draw on top of the gate so they read as lifted earth.
        updateAndDrawDust(16);

        // Chrome chips — back only. No 'Begin' pill: the figure is the trigger.
        if (sanctumT > 0.6) {
          const chipAlpha = (sanctumT - 0.6) / 0.4;
          drawBackChip(chipAlpha);
          beginHit = null;
        }
      }
    } else {
      backHit = null;
      beginHit = null;
      pillarHits = [];
      spriteHit = null;
      poolHit = null;
    }

    // Hover pass — only meaningful in cosmos view. Skip when sanctum is
    // dominant so we don't accumulate hover state under the painting.
    if (sanctumT < 0.5) {
      updateHover();
      ctx.save();
      ctx.globalAlpha = cosmosAlpha;
      drawHoverLabels(cosmosRect);
      ctx.restore();
    }

    // Cursor: pointer over orbs/Logos in cosmos, pointer over interactive
    // elements in sanctum (back chip, begin chip, pillars).
    let wantPointer = false;
    if (activeSanctum && sanctumT > 0.5) {
      if (backHit) {
        const dx = pointerX - backHit.x;
        const dy = pointerY - backHit.y;
        if (dx * dx + dy * dy <= backHit.r * backHit.r) wantPointer = true;
      }
      if (!wantPointer && poolHit && lessonPhase === 'idle') {
        if (
          pointerX >= poolHit.x &&
          pointerX <= poolHit.x + poolHit.w &&
          pointerY >= poolHit.y &&
          pointerY <= poolHit.y + poolHit.h
        ) wantPointer = true;
      }
      if (!wantPointer && lessonPhase === 'asking') {
        for (const p of pillarHits) {
          if (
            pointerX >= p.x &&
            pointerX <= p.x + p.w &&
            pointerY >= p.y &&
            pointerY <= p.y + p.h
          ) {
            wantPointer = true;
            break;
          }
        }
      }
      if (!wantPointer && lessonPhase === 'answered') {
        // Anywhere is clickable (continue).
        wantPointer = true;
      }
    } else if (sanctumT < 0.5) {
      wantPointer = !!(hoveredKey || logosHovered);
    }
    canvas.style.cursor = wantPointer ? 'pointer' : 'default';

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
