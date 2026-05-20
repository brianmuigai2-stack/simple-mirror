/* ============================================================
   DOM References
   ============================================================ */
const video            = document.getElementById('video');
const captureButton    = document.getElementById('capture');
const recordStartBtn   = document.getElementById('record-start');
const recordStopBtn    = document.getElementById('record-stop');
const clearGalleryBtn  = document.getElementById('clear-gallery');
const canvas           = document.getElementById('canvas');
const previewCanvas    = document.getElementById('preview-canvas');
const captureCanvas    = document.createElement('canvas');
const gallery          = document.getElementById('gallery');
const status           = document.getElementById('status');
const intensitySlider  = document.getElementById('intensity');
const intensityDisplay = document.getElementById('intensity-value');

/* ============================================================
   State
   ============================================================ */
let currentFilter    = 'none';
let currentTransform = 'none';
let currentIntensity = 1.0;
let mediaRecorder    = null;
let recordedChunks   = [];
let currentStream    = null;
let recordingCanvas  = canvas;
let animationFrameId = null;
let frameCount       = 0; // used for throttling heavy per-frame effects

/* ============================================================
   Performance: Pre-allocated off-screen canvases
   Reused every frame — eliminates GC pressure from per-frame canvas creation.
   ============================================================ */
const offscreenPixelate = document.createElement('canvas'); // for pixelate scale-down

/* Scanline pattern cache — rebuilt only when canvas dimensions change */
let scanlineCanvas = null;
let scanlineW = 0, scanlineH = 0;

function getOrBuildScanlines(width, height) {
    if (scanlineCanvas && scanlineW === width && scanlineH === height) return scanlineCanvas;
    scanlineCanvas = document.createElement('canvas');
    scanlineCanvas.width  = width;
    scanlineCanvas.height = height;
    const sCtx = scanlineCanvas.getContext('2d');
    sCtx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < height; y += 6) sCtx.fillRect(0, y, width, 2);
    scanlineW = width;
    scanlineH = height;
    return scanlineCanvas;
}

/* Pencil hatching cache — rebuilt only when canvas dimensions change */
let pencilCanvas = null;
let pencilW = 0, pencilH = 0;

function getOrBuildPencilHatch(width, height) {
    if (pencilCanvas && pencilW === width && pencilH === height) return pencilCanvas;
    pencilCanvas = document.createElement('canvas');
    pencilCanvas.width  = width;
    pencilCanvas.height = height;
    const pCtx = pencilCanvas.getContext('2d');
    pCtx.strokeStyle = '#222';
    pCtx.lineWidth   = 1;
    pCtx.globalAlpha = 0.07;
    const step = 12;
    for (let x = -height; x < width + height; x += step) {
        pCtx.beginPath();
        pCtx.moveTo(x, 0);
        pCtx.lineTo(x + height * 0.55, height);
        pCtx.stroke();
    }
    pencilW = width;
    pencilH = height;
    return pencilCanvas;
}

/* ============================================================
   Matrix Rain State
   ============================================================ */
const matrixRain = {
    cols:   [],
    lastW:  0,
    chars:  '0123456789ABCDEFアイウエオカキクサシスタチツナニヌ',
};

function ensureMatrixCols(width, height) {
    if (matrixRain.lastW === width) return;
    const colW  = 18;
    const count = Math.ceil(width / colW);
    matrixRain.cols = Array.from({ length: count }, () => ({
        y:     Math.random() * height * -1,
        speed: 3 + Math.random() * 5,
    }));
    matrixRain.lastW = width;
}

/* ============================================================
   Filter Definitions
   Each entry is fn(intensity: number) => CSS filter string.
   Called every animation frame — time-based entries produce smooth animation
   with zero extra canvas overhead.
   ============================================================ */
const filterDefs = {
    // --- Basic ---
    none:            ()  => 'none',
    brightness:      (t) => `brightness(${1 + 0.35 * t})`,
    contrast:        (t) => `contrast(${1 + 0.5 * t})`,
    blur:            (t) => `blur(${4 * t}px)`,
    sepia:           (t) => `sepia(${Math.min(1, 0.9 * t)})`,
    grayscale:       (t) => `grayscale(${Math.min(1, t)})`,
    'hue-rotate':    (t) => `hue-rotate(${120 * t}deg)`,
    saturate:        (t) => `saturate(${1 + 0.8 * t})`,
    invert:          (t) => `invert(${Math.min(1, t)})`,
    portrait:        (t) => `brightness(${1 + 0.05 * t}) contrast(${1 - 0.05 * t}) saturate(${1 + 0.15 * t})`,
    'soft-light':    (t) => `brightness(${1 + 0.1 * t}) contrast(${1 - 0.15 * t}) saturate(${1 + 0.1 * t})`,
    hdr:             (t) => `contrast(${1 + 0.45 * t}) saturate(${1 + 0.35 * t}) brightness(${1 - 0.05 * t})`,
    pastel:          (t) => `saturate(${1 - 0.3 * t}) brightness(${1 + 0.15 * t}) contrast(${1 - 0.1 * t})`,
    'deep-fry':      (t) => `contrast(${1 + 0.8 * t}) saturate(${1 + 1.5 * t}) brightness(${1 + 0.1 * t})`,

    // --- Creative ---
    warm:            (t) => `sepia(${0.25 * t}) saturate(${1 + 0.25 * t})`,
    cool:            (t) => `hue-rotate(${190 * t}deg) saturate(${1 + 0.1 * t})`,
    warmth:          (t) => `sepia(${0.2 * t}) saturate(${1 + 0.25 * t}) brightness(${1 + 0.05 * t})`,
    // glow: drop-shadow removed — it's a heavyweight CSS composite op on canvas
    glow:            (t) => `brightness(${1 + 0.2 * t}) saturate(${1 + 0.25 * t})`,
    'golden-hour':   (t) => `sepia(${0.35 * t}) saturate(${1 + 0.4 * t}) brightness(${1 + 0.1 * t}) hue-rotate(${-15 * t}deg)`,
    summer:          (t) => `brightness(${1 + 0.1 * t}) saturate(${1 + 0.35 * t}) hue-rotate(${-10 * t}deg)`,
    autumn:          (t) => `sepia(${0.3 * t}) saturate(${1 + 0.3 * t}) hue-rotate(${-15 * t}deg) brightness(${1 - 0.05 * t})`,
    arctic:          (t) => `hue-rotate(${200 * t}deg) saturate(${1 + 0.2 * t}) brightness(${1 + 0.05 * t}) contrast(${1 + 0.1 * t})`,
    faded:           (t) => `contrast(${1 - 0.15 * t}) brightness(${1 + 0.1 * t}) saturate(${1 - 0.2 * t})`,
    matte:           (t) => `contrast(${1 - 0.1 * t}) brightness(${1 + 0.05 * t}) saturate(${1 - 0.15 * t})`,
    lofi:            (t) => `contrast(${1 + 0.1 * t}) sepia(${0.15 * t}) saturate(${1 - 0.1 * t}) brightness(${1 - 0.05 * t})`,
    anime:           (t) => `contrast(${1 + 0.2 * t}) saturate(${1 + 0.5 * t}) brightness(${1 + 0.05 * t})`,
    lark:            (t) => `saturate(${1 + 0.35 * t}) brightness(${1 + 0.1 * t})`,
    moon:            (t) => `grayscale(${Math.min(1, t)}) brightness(${1 + 0.1 * t})`,
    gingham:         (t) => `contrast(${1 - 0.1 * t}) brightness(${1 + 0.05 * t}) sepia(${0.2 * t})`,

    // --- Cinematic ---
    vintage:         (t) => `contrast(${1 + 0.1 * t}) sepia(${0.4 * t}) saturate(${1 + 0.1 * t})`,
    drama:           (t) => `contrast(${1 + 0.4 * t}) saturate(${1 + 0.2 * t}) brightness(${1 - 0.05 * t})`,
    cinematic:       (t) => `contrast(${1 + 0.2 * t}) sepia(${0.1 * t}) saturate(${1 + 0.3 * t}) brightness(${1 - 0.05 * t})`,
    pop:             (t) => `contrast(${1 + 0.3 * t}) saturate(${1 + 0.5 * t}) brightness(${1 + 0.05 * t})`,
    mono:            (t) => `grayscale(${Math.min(1, t)}) contrast(${1 + 0.2 * t})`,
    cold:            (t) => `brightness(${1 + 0.05 * t}) contrast(${1 + 0.1 * t}) hue-rotate(${200 * t}deg) saturate(${1 - 0.1 * t})`,
    clarendon:       (t) => `contrast(${1 + 0.1 * t}) saturate(${1 + 0.35 * t}) brightness(${1 + 0.05 * t})`,
    maven:           (t) => `contrast(${1 + 0.2 * t}) saturate(${1 + 0.25 * t}) hue-rotate(${-5 * t}deg)`,
    kodachrome:      (t) => `contrast(${1 + 0.2 * t}) saturate(${1 + 0.35 * t}) brightness(${1 - 0.05 * t}) hue-rotate(${-5 * t}deg)`,
    fuji:            (t) => `contrast(${1 + 0.05 * t}) saturate(${1 + 0.1 * t}) hue-rotate(${5 * t}deg) brightness(${1 + 0.05 * t})`,
    noir:            (t) => `grayscale(${Math.min(1, t)}) contrast(${1 + 0.5 * t}) brightness(${1 - 0.15 * t})`,
    bleach:          (t) => `contrast(${1 + 0.3 * t}) saturate(${1 - 0.3 * t}) brightness(${1 + 0.1 * t})`,
    'cross-process': (t) => `hue-rotate(${90 * t}deg) contrast(${1 + 0.3 * t}) saturate(${1 + 0.4 * t})`,
    'teal-orange':   (t) => `contrast(${1 + 0.15 * t}) saturate(${1 + 0.2 * t}) hue-rotate(${-10 * t}deg)`,

    // --- Special: canvas-overlay animated ---
    sparkle:         (t) => `brightness(${1 + 0.2 * t}) saturate(${1 + 0.1 * t})`,
    neon:            (t) => `contrast(${1 + 0.3 * t}) saturate(${1 + 0.4 * t}) brightness(${1 + 0.1 * t})`,
    glitch:          (t) => `contrast(${1 + 0.2 * t}) brightness(${1 + 0.05 * t})`,
    vhs:             (t) => `contrast(${1 + 0.15 * t}) brightness(${1 + 0.05 * t})`,
    rainbow:         (t) => `saturate(${1 + 0.35 * t}) hue-rotate(${20 * t}deg)`,
    duotone:         (t) => `grayscale(${Math.min(1, 0.7 * t)}) contrast(${1 + 0.1 * t})`,
    'night-vision':  (t) => `grayscale(${Math.min(1, t)}) contrast(${1 + 0.2 * t}) brightness(${1 + 0.1 * t})`,
    thermal:         (t) => `grayscale(${Math.min(1, t)})`,
    pixelate:        ()  => 'none',
    pencil:          (t) => `grayscale(${Math.min(1, t)}) contrast(${1 + 0.5 * t}) brightness(${1 + 0.15 * t})`,

    // --- Animated filters: pure CSS (performance.now() makes them animate per-frame) ---
    // hue-cycle: hue rotates ~360° every 10s
    'hue-cycle':     (t) => `hue-rotate(${(performance.now() / 28 * t) % 360}deg) saturate(${1 + 0.3 * t})`,
    // pulse: brightness + saturation breathe in/out
    'pulse':         (t) => `brightness(${1 + 0.35 * t * Math.sin(performance.now() / 480)}) saturate(${1 + 0.25 * t * Math.cos(performance.now() / 550)})`,

    // --- Animated filters: canvas-overlay ---
    chromatic:       (t) => `contrast(${1 + 0.1 * t}) saturate(${1 + 0.15 * t})`,
    matrix:          (t) => `grayscale(${Math.min(1, t * 0.7)}) brightness(${1 + 0.1 * t})`,
    fire:            (t) => `saturate(${1 + 0.3 * t}) contrast(${1 + 0.1 * t}) brightness(${1 + 0.05 * t})`,
    aurora:          (t) => `saturate(${1 + 0.2 * t}) contrast(${1 + 0.05 * t})`,
};

/* Filters that call drawAnimatedOverlay each frame */
const CANVAS_OVERLAY_FILTERS = new Set([
    'sparkle', 'neon', 'glitch', 'vhs', 'rainbow',
    'duotone', 'night-vision', 'thermal', 'teal-orange', 'pencil',
    'chromatic', 'matrix', 'fire', 'aurora',
]);

/* ============================================================
   Helpers
   ============================================================ */
function getFilterCSS(key) {
    const def = filterDefs[key];
    return (def ? def(currentIntensity) : null) || 'none';
}

/* ============================================================
   Event Listeners — Intensity Slider
   ============================================================ */
intensitySlider.addEventListener('input', () => {
    currentIntensity = parseFloat(intensitySlider.value);
    intensityDisplay.textContent = Math.round(currentIntensity * 100) + '%';
});

/* ============================================================
   Event Listeners — Filter Tabs
   ============================================================ */
const tabBtns      = document.querySelectorAll('.tab-btn');
const filterPanels = document.querySelectorAll('.filter-panel');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => {
            b.classList.toggle('active', b === btn);
            b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        filterPanels.forEach(p => p.classList.toggle('active', p.dataset.panel === btn.dataset.tab));
    });
});

/* ============================================================
   Event Listeners — Filter Buttons
   ============================================================ */
const filterButtons = document.querySelectorAll('.filter-btn');

filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        currentFilter = btn.dataset.filter;
        filterButtons.forEach(other => other.classList.toggle('active', other === btn));
    });
});

/* ============================================================
   Event Listeners — Transform Buttons
   ============================================================ */
const transformButtons = document.querySelectorAll('.transform-btn');

transformButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        currentTransform = btn.dataset.transform;
        transformButtons.forEach(other => other.classList.toggle('active', other === btn));
    });
});

/* ============================================================
   Canvas Rendering Loop
   ============================================================ */
const previewCtx = previewCanvas.getContext('2d');

function drawVideoToCanvas() {
    if (!video.videoWidth || !video.videoHeight) {
        animationFrameId = requestAnimationFrame(drawVideoToCanvas);
        return;
    }

    if (recordingCanvas.width !== video.videoWidth || recordingCanvas.height !== video.videoHeight) {
        recordingCanvas.width  = video.videoWidth;
        recordingCanvas.height = video.videoHeight;
    }
    if (previewCanvas.width !== video.videoWidth || previewCanvas.height !== video.videoHeight) {
        previewCanvas.width  = video.videoWidth;
        previewCanvas.height = video.videoHeight;
    }

    drawVideoWithEffects(previewCtx, previewCanvas.width, previewCanvas.height);

    // Only draw to recordingCanvas when actively recording — halves GPU work otherwise
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        drawVideoWithEffects(recordingCanvas.getContext('2d'), recordingCanvas.width, recordingCanvas.height);
    }

    frameCount++;
    animationFrameId = requestAnimationFrame(drawVideoToCanvas);
}

function drawVideoWithEffects(ctx, width, height) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.filter = getFilterCSS(currentFilter);

    switch (currentTransform) {
        case 'rotateLeft':
            ctx.translate(width / 2, height / 2);
            ctx.rotate(-10 * Math.PI / 180);
            ctx.drawImage(video, -width / 2, -height / 2, width, height);
            break;
        case 'rotateRight':
            ctx.translate(width / 2, height / 2);
            ctx.rotate(10 * Math.PI / 180);
            ctx.drawImage(video, -width / 2, -height / 2, width, height);
            break;
        case 'flip':
            ctx.translate(width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0, width, height);
            break;
        case 'skew':
            ctx.transform(1, 0, 0.3, 1, 0, 0);
            ctx.drawImage(video, 0, 0, width, height);
            break;
        default:
            ctx.drawImage(video, 0, 0, width, height);
    }

    if (currentFilter === 'pixelate') applyPixelate(ctx, width, height);
    if (CANVAS_OVERLAY_FILTERS.has(currentFilter)) drawAnimatedOverlay(ctx, width, height);

    ctx.restore();
}

/* ============================================================
   Pixelate — uses pre-allocated offscreen canvas (no per-frame allocation)
   ============================================================ */
function applyPixelate(ctx, width, height) {
    const pixelSize = Math.max(2, Math.floor(10 * currentIntensity));
    if (pixelSize <= 1) return;

    const w = Math.max(1, Math.floor(width  / pixelSize));
    const h = Math.max(1, Math.floor(height / pixelSize));

    offscreenPixelate.width  = w;
    offscreenPixelate.height = h;
    offscreenPixelate.getContext('2d').drawImage(ctx.canvas, 0, 0, w, h);

    ctx.filter = 'none';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreenPixelate, 0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
}

/* ============================================================
   Animated Canvas Overlay Effects
   ============================================================ */
function drawAnimatedOverlay(ctx, width, height) {
    const now  = performance.now() / 1000;
    const t    = currentIntensity;
    const tCap = Math.min(t, 1.5);

    /* ---- Sparkle ---- */
    if (currentFilter === 'sparkle') {
        const count = 12;
        for (let i = 0; i < count; i++) {
            const x    = (Math.sin(now * 1.5 + i * 1.1) * 0.44 + 0.5) * width;
            const y    = (Math.cos(now * 1.7 + i * 1.2) * 0.44 + 0.5) * height;
            const size = (4 + 9 * Math.abs(Math.sin(now + i))) * Math.min(t, 1.2);
            ctx.fillStyle = `rgba(255,255,255,${0.6 * tCap})`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ---- Neon ---- */
    if (currentFilter === 'neon') {
        const pulse = 0.35 + 0.18 * Math.sin(now * 2.5);
        ctx.globalAlpha = 0.15 * t;
        ctx.fillStyle   = 'cyan';
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = `rgba(255,0,255,${pulse * tCap})`;
        ctx.lineWidth   = 14;
        ctx.strokeRect(20, 20, width - 40, height - 40);
        ctx.lineWidth   = 4;
        ctx.strokeStyle = `rgba(0,255,255,${pulse * 0.55 * tCap})`;
        ctx.strokeRect(28, 28, width - 56, height - 56);
    }

    /* ---- Glitch — throttled to every 2nd frame ---- */
    if (currentFilter === 'glitch' && frameCount % 2 === 0) {
        const sliceH = 20;
        for (let y = 0; y < height; y += sliceH * 4) {
            if (Math.random() > 0.65) {
                const offset = (8 + Math.sin(now * 8 + y) * 20) * Math.min(t, 1);
                ctx.globalAlpha = 0.85;
                ctx.drawImage(video, 0, y, width, sliceH, offset, y, width, sliceH);
                ctx.globalAlpha = 0.2 * tCap;
                ctx.fillStyle = 'rgba(255,0,0,1)';
                ctx.fillRect(offset + 2, y, width, sliceH * 0.35);
                ctx.fillStyle = 'rgba(0,255,255,1)';
                ctx.fillRect(offset - 2, y + sliceH * 0.65, width, sliceH * 0.35);
                ctx.globalAlpha = 1;
            }
        }
    }

    /* ---- VHS — cached scanlines for performance ---- */
    if (currentFilter === 'vhs') {
        ctx.globalAlpha = 0.55 * Math.min(tCap, 1);
        ctx.drawImage(getOrBuildScanlines(width, height), 0, 0);
        ctx.globalAlpha = 1;
        const bandY = height * 0.15 + Math.sin(now * 6.5) * (height * 0.08);
        ctx.strokeStyle = `rgba(255,0,150,${(0.12 + 0.1 * Math.sin(now * 9)) * tCap})`;
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(0, bandY);
        ctx.lineTo(width, bandY + Math.sin(now * 3) * 6);
        ctx.stroke();
        ctx.globalAlpha = 0.03 * tCap;
        ctx.fillStyle   = 'red';
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
    }

    /* ---- Rainbow ---- */
    if (currentFilter === 'rainbow') {
        const off = (Math.sin(now * 1.5) + 1) / 2;
        const g   = ctx.createLinearGradient(0, 0, width, height);
        g.addColorStop(0,    `hsla(${off * 360},               100%, 65%, ${0.2 * t})`);
        g.addColorStop(0.33, `hsla(${(off * 360 + 90)  % 360}, 100%, 65%, ${0.17 * t})`);
        g.addColorStop(0.66, `hsla(${(off * 360 + 180) % 360}, 100%, 65%, ${0.17 * t})`);
        g.addColorStop(1,    `hsla(${(off * 360 + 270) % 360}, 100%, 65%, ${0.2 * t})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
    }

    /* ---- Duotone ---- */
    if (currentFilter === 'duotone') {
        const hue1 = 255 + Math.sin(now * 0.35) * 30;
        const hue2 = 30  + Math.sin(now * 0.35) * 20;
        ctx.globalCompositeOperation = 'multiply';
        const g = ctx.createLinearGradient(0, 0, width, height);
        g.addColorStop(0, `hsla(${hue1}, 75%, 38%, ${0.75 * tCap})`);
        g.addColorStop(1, `hsla(${hue2}, 90%, 58%, ${0.70 * tCap})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
    }

    /* ---- Night Vision — cached scanlines ---- */
    if (currentFilter === 'night-vision') {
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(0,210,55,${0.42 * tCap})`;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 0.45 * tCap;
        ctx.drawImage(getOrBuildScanlines(width, height), 0, 0);
        ctx.globalAlpha = 1;
        const vig = ctx.createRadialGradient(width / 2, height / 2, height * 0.22, width / 2, height / 2, height * 0.72);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, `rgba(0,0,0,${0.58 * tCap})`);
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);
    }

    /* ---- Thermal ---- */
    if (currentFilter === 'thermal') {
        ctx.globalCompositeOperation = 'color';
        const g = ctx.createLinearGradient(0, 0, width, height);
        g.addColorStop(0,    `hsla(270, 80%, 32%, ${0.85 * tCap})`);
        g.addColorStop(0.28, `hsla(210, 85%, 42%, ${0.75 * tCap})`);
        g.addColorStop(0.52, `hsla(120, 75%, 42%, ${0.70 * tCap})`);
        g.addColorStop(0.74, `hsla(42,  95%, 52%, ${0.75 * tCap})`);
        g.addColorStop(1,    `hsla(0,  100%, 52%, ${0.85 * tCap})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
    }

    /* ---- Teal & Orange ---- */
    if (currentFilter === 'teal-orange') {
        ctx.globalCompositeOperation = 'screen';
        const g = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.75);
        g.addColorStop(0, `rgba(210,95,0,${0.18 * t})`);
        g.addColorStop(1, `rgba(0,110,130,${0.22 * t})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
    }

    /* ---- Pencil — cached hatching for performance ---- */
    if (currentFilter === 'pencil') {
        ctx.globalAlpha = 0.18 * tCap;
        ctx.fillStyle   = '#f5eed8';
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = tCap;
        ctx.drawImage(getOrBuildPencilHatch(width, height), 0, 0);
        ctx.globalAlpha = 1;
    }

    /* ======================================================
       NEW ANIMATED FILTERS
       ====================================================== */

    /* ---- Chromatic Aberration — animated RGB channel split ---- */
    if (currentFilter === 'chromatic') {
        const shift = (5 + 4 * Math.abs(Math.sin(now * 2.2))) * Math.min(t, 1);
        // Screen-blend two shifted copies; colour fringing emerges at high-contrast edges
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.38 * Math.min(t, 1);
        ctx.drawImage(video, shift, 0, width, height);   // right — appears reddish
        ctx.drawImage(video, -shift, 0, width, height);  // left  — appears bluish
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        // Subtle magenta vignette to tie the look together
        const vig = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, height * 0.8);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, `rgba(80,0,120,${0.2 * tCap})`);
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, width, height);
    }

    /* ---- Matrix Rain — falling katakana / hex characters ---- */
    if (currentFilter === 'matrix') {
        ensureMatrixCols(width, height);
        const colW  = 18;
        const chars = matrixRain.chars;
        ctx.font = `bold 14px monospace`;

        for (let i = 0; i < matrixRain.cols.length; i++) {
            const col = matrixRain.cols[i];
            col.y += col.speed;
            if (col.y > height + 20) col.y = -(10 + Math.random() * 80);

            const x = i * colW;
            // Leading character (bright)
            ctx.fillStyle = `rgba(180,255,180,${0.95 * tCap})`;
            ctx.fillText(chars[Math.floor(Math.random() * chars.length)], x, col.y);
            // Trail characters (progressively dimmer)
            ctx.fillStyle = `rgba(0,210,65,${0.55 * tCap})`;
            if (col.y > 18)  ctx.fillText(chars[Math.floor(Math.random() * chars.length)], x, col.y - 18);
            ctx.fillStyle = `rgba(0,155,45,${0.28 * tCap})`;
            if (col.y > 36)  ctx.fillText(chars[Math.floor(Math.random() * chars.length)], x, col.y - 36);
            ctx.fillStyle = `rgba(0,100,30,${0.12 * tCap})`;
            if (col.y > 54)  ctx.fillText(chars[Math.floor(Math.random() * chars.length)], x, col.y - 54);
        }
    }

    /* ---- Fire — flickering flames rising from the bottom ---- */
    if (currentFilter === 'fire') {
        // Base fire gradient
        const fireGrd = ctx.createLinearGradient(0, height, 0, height * 0.45);
        fireGrd.addColorStop(0,    `rgba(255,50,0,${0.85 * tCap})`);
        fireGrd.addColorStop(0.25, `rgba(255,120,0,${0.6 * tCap})`);
        fireGrd.addColorStop(0.6,  `rgba(255,60,0,${0.2 * tCap})`);
        fireGrd.addColorStop(1,    'rgba(0,0,0,0)');
        ctx.fillStyle = fireGrd;
        ctx.fillRect(0, 0, width, height);

        // Flickering flame tongues
        const tongues = 9;
        for (let i = 0; i < tongues; i++) {
            const cx  = ((i + 0.5) / tongues) * width + Math.sin(now * 2.5 + i * 1.1) * 45;
            const fh  = (0.18 + 0.14 * Math.sin(now * 4.5 + i * 1.7)) * height * Math.min(t, 1.2);
            const fGrd = ctx.createRadialGradient(cx, height, 0, cx, height - fh, fh * 0.6);
            fGrd.addColorStop(0, `rgba(255,220,0,${0.65 * tCap})`);
            fGrd.addColorStop(0.4, `rgba(255,80,0,${0.35 * tCap})`);
            fGrd.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = fGrd;
            ctx.fillRect(cx - fh * 0.5, height - fh, fh, fh);
        }

        // Ember particles
        for (let e = 0; e < 18; e++) {
            const ex    = width  * ((Math.sin(now * 1.3 + e * 2.4) + 1) / 2);
            const ey    = height - (((now * (20 + e * 3)) % height) * tCap);
            const alpha = Math.max(0, 1 - (height - ey) / (height * 0.55 * tCap));
            ctx.fillStyle = `rgba(255,${140 + Math.random() * 80},0,${alpha * 0.8})`;
            ctx.beginPath();
            ctx.arc(ex, ey, 2 + Math.random() * 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /* ---- Aurora Borealis — wavy colour bands ---- */
    if (currentFilter === 'aurora') {
        const bands = 5;
        for (let b = 0; b < bands; b++) {
            const hue   = (155 + b * 35 + now * 12) % 360;
            const baseY = height * (0.18 + 0.11 * b);
            const bandH = height * (0.1 + 0.04 * Math.sin(now * 0.9 + b));

            ctx.beginPath();
            ctx.moveTo(0, baseY - bandH);
            for (let x = 0; x <= width; x += 16) {
                const wy = baseY + Math.sin(x * 0.008 + now * 1.4 + b * 1.3) * bandH * 0.5
                                 + Math.sin(x * 0.003 + now * 0.7 + b) * bandH * 0.3;
                ctx.lineTo(x, wy);
            }
            ctx.lineTo(width, baseY + bandH * 2);
            ctx.lineTo(0,     baseY + bandH * 2);
            ctx.closePath();

            const g = ctx.createLinearGradient(0, baseY - bandH, 0, baseY + bandH * 2);
            g.addColorStop(0,   'rgba(0,0,0,0)');
            g.addColorStop(0.4, `hsla(${hue},100%,65%,${(0.22 + 0.06 * Math.sin(now * 1.8 + b)) * tCap})`);
            g.addColorStop(1,   'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fill();
        }
    }
}

/* ============================================================
   Camera Startup
   ============================================================ */
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width:       { ideal: 1920 },
                height:      { ideal: 1080 },
                frameRate:   { ideal: 60 },
                aspectRatio: { ideal: 16 / 9 },
                facingMode:  'user',
            },
            audio: true,
        });

        currentStream = stream;
        video.srcObject = stream;
        await video.play();

        const settings = stream.getVideoTracks()[0].getSettings();
        const w = settings.width  || video.videoWidth  || 1920;
        const h = settings.height || video.videoHeight || 1080;

        recordingCanvas.width = w;
        recordingCanvas.height = h;
        previewCanvas.width   = w;
        previewCanvas.height  = h;
        captureCanvas.width   = w;
        captureCanvas.height  = h;

        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
            status.textContent = `Camera active. Microphone detected (${audioTracks.length} audio track${audioTracks.length > 1 ? 's' : ''}). Choose a filter, take a picture, or record.`;
        } else {
            status.textContent = 'Camera active. No microphone found; recordings may be silent. Please allow microphone access.';
        }

        drawVideoToCanvas();
    } catch (err) {
        status.textContent = 'Unable to access camera. Please allow permission.';
        console.error('Camera error:', err);
    }
}

/* ============================================================
   Photo Capture
   ============================================================ */
function capturePhoto() {
    if (!currentStream) { status.textContent = 'Camera not ready yet.'; return; }
    if (!video.videoWidth || !video.videoHeight) { status.textContent = 'Preparing capture... Please wait a moment.'; return; }

    captureCanvas.width  = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    const ctx = captureCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawVideoWithEffects(ctx, captureCanvas.width, captureCanvas.height);

    captureCanvas.toBlob(blob => {
        if (!blob) { status.textContent = 'Failed to capture photo.'; return; }
        const url = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Captured photo';
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        createGalleryItem('photo', img, url, `mirror-photo-${ts}.png`);
        status.textContent = 'Photo captured and ready to save.';
    }, 'image/png');
}

/* ============================================================
   Video Recording
   ============================================================ */
function startRecording() {
    if (!currentStream) { status.textContent = 'Camera not ready yet.'; return; }

    recordedChunks = [];
    const canvasStream = recordingCanvas.captureStream(60);
    const combined     = new MediaStream();
    const videoTrack   = canvasStream.getVideoTracks()[0];
    if (videoTrack) combined.addTrack(videoTrack);

    const audioTracks = currentStream.getAudioTracks();
    audioTracks.forEach(track => {
        track.enabled = true;
        combined.addTrack(track);
    });

    if (audioTracks.length === 0) {
        status.textContent = 'Recording without audio: no microphone track detected.';
    } else {
        status.textContent = 'Recording with audio.';
    }

    let mimeType = null;
    if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9,opus')) {
        mimeType = 'video/webm; codecs=vp9,opus';
    } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8,opus')) {
        mimeType = 'video/webm; codecs=vp8,opus';
    } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8')) {
        mimeType = 'video/webm; codecs=vp8';
    }

    const recorderOptions = {
        videoBitsPerSecond: 8_000_000,
        audioBitsPerSecond: 128_000,
    };
    if (mimeType) recorderOptions.mimeType = mimeType;

    mediaRecorder = new MediaRecorder(combined, recorderOptions);

    mediaRecorder.addEventListener('dataavailable', e => {
        if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    });

    mediaRecorder.addEventListener('stop', () => {
        const blob  = new Blob(recordedChunks, { type: 'video/webm' });
        const url   = URL.createObjectURL(blob);
        const vPrev = document.createElement('video');
        vPrev.controls  = true;
        vPrev.src       = url;
        vPrev.className = 'gallery-video';
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        createGalleryItem('video', vPrev, url, `mirror-video-${ts}.webm`);
        status.textContent = 'Video recording saved to gallery. Use Save to export it.';
    });

    mediaRecorder.start();
    recordStartBtn.disabled = true;
    recordStopBtn.disabled  = false;
    status.textContent      = 'Recording... Click stop when finished.';
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    recordStartBtn.disabled = false;
    recordStopBtn.disabled  = true;
}

/* ============================================================
   Gallery
   ============================================================ */
function createGalleryItem(type, mediaEl, downloadUrl, filename) {
    const card = document.createElement('div');
    card.className = 'gallery-item';

    const label = document.createElement('div');
    label.className   = 'media-label';
    label.textContent = type === 'photo' ? 'Photo' : 'Video';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className   = 'save-btn';
    saveBtn.addEventListener('click', () => saveFile(downloadUrl, filename));

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.className   = 'remove-btn';
    removeBtn.addEventListener('click', () => card.remove());

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(saveBtn, removeBtn);

    card.append(label, mediaEl, actions);
    gallery.prepend(card);
}

async function saveFile(url, filename) {
    if (window.showSaveFilePicker) {
        try {
            const handle   = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{ description: 'Media file', accept: { 'image/png': ['.png'], 'video/webm': ['.webm'] } }],
            });
            const writable = await handle.createWritable();
            const blob     = await (await fetch(url)).blob();
            await writable.write(blob);
            await writable.close();
            status.textContent = `${filename} saved successfully.`;
            return;
        } catch (err) {
            console.warn('Save cancelled:', err);
        }
    }
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    status.textContent = `Download started for ${filename}.`;
}

function clearGallery() {
    gallery.innerHTML  = '';
    status.textContent = 'Gallery cleared.';
}

/* ============================================================
   Wire up controls
   ============================================================ */
captureButton.addEventListener('click', capturePhoto);
recordStartBtn.addEventListener('click', startRecording);
recordStopBtn.addEventListener('click', stopRecording);
clearGalleryBtn.addEventListener('click', clearGallery);

startCamera();
