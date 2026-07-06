// Assemble email addresses at runtime so the raw HTML holds no scrapeable address.
document.querySelectorAll(".email-link").forEach((el) => {
  try {
    const addr = atob(el.dataset.e);
    el.href = "mailto:" + addr;
    if (el.classList.contains("email-show")) el.textContent = addr;
  } catch (e) {}
});

// Scroll-reveal
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); }
    });
  },
  { threshold: 0.12 }
);
document.querySelectorAll(".reveal").forEach((el, i) => {
  el.style.transitionDelay = `${Math.min(i % 3, 2) * 70}ms`;
  io.observe(el);
});
