// Assemble email addresses at runtime so the raw HTML holds no scrapeable address.
document.querySelectorAll(".email-link").forEach((el) => {
  try {
    const addr = atob(el.dataset.e);
    el.href = "mailto:" + addr;
    if (el.classList.contains("email-show")) el.textContent = addr;
  } catch (e) {}
});

// Light/dark toggle. The initial theme is set inline in <head> to avoid a flash.
const toggle = document.getElementById("theme-toggle");
if (toggle) {
  toggle.addEventListener("click", () => {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    if (dark) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", "dark");
    try {
      localStorage.setItem("theme", dark ? "light" : "dark");
    } catch (e) {}
  });
}

// Party mode: the dark palette, plus a spinning disco ball that stands in for
// the pointer, trailing four-pointed sparkles. The ball is centred on the real
// pointer position, so clicks still land where they look like they land.
(function () {
  const root = document.documentElement;
  const btn = document.getElementById("party-toggle");
  const ball = document.getElementById("disco");
  if (!btn || !ball) return;

  // A custom cursor only makes sense with a real pointer.
  const finePointer = window.matchMedia("(pointer: fine)").matches;

  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  let frame = null;

  function place() {
    frame = null;
    // The ball sits at (50, 50) in a 100-wide box.
    ball.style.transform = "translate(" + (x - 50) + "px," + (y - 50) + "px)";
  }

  function onMove(e) {
    x = e.clientX;
    y = e.clientY;
    if (frame === null) frame = requestAnimationFrame(place);
  }

  function fire(on) {
    ball.classList.toggle("is-firing", on);
  }

  function setParty(on) {
    if (on) {
      root.setAttribute("data-party", "");
      root.setAttribute("data-theme", "dark");
      if (finePointer) {
        root.classList.add("has-cursor");
        place();
        window.addEventListener("mousemove", onMove, { passive: true });
        window.addEventListener("mousedown", fireOn);
        window.addEventListener("mouseup", fireOff);
      } else {
        // No pointer to follow, so hang the ball from the top of the screen.
        ball.style.transform = "";
        ball.classList.add("disco--hanging");
      }
    } else {
      root.removeAttribute("data-party");
      root.classList.remove("has-cursor");
      ball.classList.remove("disco--hanging");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", fireOn);
      window.removeEventListener("mouseup", fireOff);
      fire(false);
      // Fall back to whatever theme was chosen before the party started.
      let saved = null;
      try { saved = localStorage.getItem("theme"); } catch (e) {}
      if (saved === "dark") root.setAttribute("data-theme", "dark");
      else root.removeAttribute("data-theme");
    }
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "[ party mode: on ]" : "[ party mode ]";
  }

  function fireOn() { fire(true); }
  function fireOff() { fire(false); }

  btn.addEventListener("click", () => {
    setParty(!root.hasAttribute("data-party"));
  });

  // Deliberately not restored from a previous visit: party mode starts off.
  try { localStorage.removeItem("party"); } catch (e) {}
})();
