/* =========================================================
   ShelfLife Radar — Luxury Fluid Cursor & Universal Hover Physics
   Active across the entire site (Home, Store/Shelf, Insights, Settings)
   - Dynamic Trailing Cursor (Dot + Lerp Inertia Ring)
   - Universal Cursor Morphing via Event Delegation
   - Universal Magnetic Pull on Buttons, Tabs, & Controls
   - 3D Perspective Card Tilt with Specular Mouse Glare
   ========================================================= */

(function () {
  "use strict";

  var isFinePointer = window.matchMedia("(pointer: fine)").matches;
  var isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ==========================================
  // 1. Fluid Custom Magnetic Cursor
  // ==========================================
  function initCustomCursor() {
    if (!isFinePointer || isReducedMotion) return;

    var dot = document.createElement("div");
    dot.className = "custom-cursor-dot";

    var ring = document.createElement("div");
    ring.className = "custom-cursor-ring";

    document.body.appendChild(dot);
    document.body.appendChild(ring);
    document.body.classList.add("has-custom-cursor");

    var mouseX = window.innerWidth / 2;
    var mouseY = window.innerHeight / 2;
    var ringX = mouseX;
    var ringY = mouseY;
    var isVisible = false;

    // Track mouse position
    window.addEventListener("mousemove", function (e) {
      mouseX = e.clientX;
      mouseY = e.clientY;

      dot.style.transform = "translate3d(" + mouseX + "px, " + mouseY + "px, 0) translate(-50%, -50%)";

      if (!isVisible) {
        isVisible = true;
        dot.style.opacity = "1";
        ring.style.opacity = "1";
      }
    }, { passive: true });

    document.addEventListener("mouseleave", function () {
      isVisible = false;
      dot.style.opacity = "0";
      ring.style.opacity = "0";
    });

    document.addEventListener("mouseenter", function () {
      isVisible = true;
      dot.style.opacity = "1";
      ring.style.opacity = "1";
    });

    // Smooth Lerp loop for trailing ring
    function render() {
      ringX += (mouseX - ringX) * 0.18;
      ringY += (mouseY - ringY) * 0.18;

      ring.style.transform = "translate3d(" + ringX.toFixed(2) + "px, " + ringY.toFixed(2) + "px, 0) translate(-50%, -50%)";

      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);

    // Dynamic Event Delegation for Cursor Morphing across ALL elements (static + dynamic)
    document.addEventListener("mouseover", function (e) {
      var t = e.target;
      if (!t) return;

      var btn = t.closest(".btn, button, .apptab, .tab, .info, .mast__link, [role='button'], [data-add], [data-install]");
      var link = t.closest("a, .brand, .tag, .week__day");
      var input = t.closest("input, textarea, select");
      var text = t.closest("h1, h2, h3, .figure__value, .opening__title, .pagehead__title, .hero__title, .why__text");
      var card = t.closest("[data-tilt], .pageblock, .figure, .batch, .product, .art, .set__panel, .stamp, .step");

      document.body.classList.remove("cursor-hover-btn", "cursor-hover-link", "cursor-hover-input", "cursor-hover-text", "cursor-hover-card");

      if (btn) {
        document.body.classList.add("cursor-hover-btn");
      } else if (input) {
        document.body.classList.add("cursor-hover-input");
      } else if (link) {
        document.body.classList.add("cursor-hover-link");
      } else if (text) {
        document.body.classList.add("cursor-hover-text");
      } else if (card) {
        document.body.classList.add("cursor-hover-card");
      }
    }, { passive: true });
  }

  // ==========================================
  // 2. 3D Card Tilt with Specular Mouse Glare
  // ==========================================
  function initTilt() {
    if (!isFinePointer || isReducedMotion) return;

    var selector = "[data-tilt], .art, .figure, .pageblock";

    document.addEventListener("mousemove", function (e) {
      var card = e.target.closest(selector);
      if (!card) return;

      // Ensure glare overlay exists
      if (!card.querySelector(".tilt-glare")) {
        var glare = document.createElement("div");
        glare.className = "tilt-glare";
        card.appendChild(glare);
      }

      var rect = card.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var y = e.clientY - rect.top;
      var centerX = rect.width / 2;
      var centerY = rect.height / 2;

      var rotateX = ((y - centerY) / centerY) * -5; // max 5 deg
      var rotateY = ((x - centerX) / centerX) * 5;

      card.style.transform = "perspective(1000px) rotateX(" + rotateX.toFixed(2) + "deg) rotateY(" + rotateY.toFixed(2) + "deg) scale3d(1.012, 1.012, 1.012)";
      card.style.setProperty("--mouse-x", x + "px");
      card.style.setProperty("--mouse-y", y + "px");
    }, { passive: true });

    document.addEventListener("mouseout", function (e) {
      var card = e.target.closest(selector);
      if (!card) return;

      // Reset when leaving card bounds
      if (!card.contains(e.relatedTarget)) {
        card.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)";
      }
    }, { passive: true });
  }

  // ==========================================
  // 3. Universal Magnetic Pull on Buttons & Tabs
  // ==========================================
  function initMagnetic() {
    if (!isFinePointer || isReducedMotion) return;

    var magneticSelector = ".btn-magnetic, .btn, .apptab, .mast__link, .tab, .info, .theme-toggle";
    var activeTarget = null;

    document.addEventListener("mousemove", function (e) {
      var target = e.target.closest(magneticSelector);
      if (target) {
        activeTarget = target;
        var rect = target.getBoundingClientRect();
        var x = e.clientX - rect.left - rect.width / 2;
        var y = e.clientY - rect.top - rect.height / 2;
        target.style.transform = "translate3d(" + (x * 0.28).toFixed(1) + "px, " + (y * 0.28).toFixed(1) + "px, 0)";
      } else if (activeTarget) {
        activeTarget.style.transform = "translate3d(0, 0, 0)";
        activeTarget = null;
      }
    }, { passive: true });

    document.addEventListener("mouseout", function (e) {
      var target = e.target.closest(magneticSelector);
      if (target && !target.contains(e.relatedTarget)) {
        target.style.transform = "translate3d(0, 0, 0)";
        if (activeTarget === target) activeTarget = null;
      }
    }, { passive: true });
  }

  // ==========================================
  // Initialize
  // ==========================================
  function init() {
    initCustomCursor();
    initTilt();
    initMagnetic();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
