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
