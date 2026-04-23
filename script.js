const header = document.querySelector(".site-header");
const toggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelectorAll(".site-nav a");
const year = document.querySelector("#year");
const revealTargets = document.querySelectorAll("[data-reveal]");

if (toggle && header) {
  toggle.addEventListener("click", () => {
    const isOpen = header.classList.toggle("menu-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });
}

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    header?.classList.remove("menu-open");
    toggle?.setAttribute("aria-expanded", "false");
  });
});

if (year) {
  year.textContent = String(new Date().getFullYear());
}

const syncHeaderState = () => {
  if (!header) return;
  header.classList.toggle("scrolled", window.scrollY > 12);
};

syncHeaderState();
window.addEventListener("scroll", syncHeaderState, { passive: true });

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    {
      threshold: 0.18,
      rootMargin: "0px 0px -40px 0px",
    }
  );

  revealTargets.forEach((target) => observer.observe(target));
} else {
  revealTargets.forEach((target) => target.classList.add("is-visible"));
}
