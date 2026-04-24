const body = document.body;
const header = document.querySelector(".site-header");
const toggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelectorAll(".site-nav a");
const year = document.querySelector("#year");
const revealTargets = document.querySelectorAll("[data-reveal]");
const intro = document.querySelector(".intro-overlay");
const popup = document.querySelector("[data-popup]");
const popupCloseButtons = document.querySelectorAll("[data-popup-close], [data-popup-anchor]");
const imageOpenButtons = document.querySelectorAll("[data-image-open]");

let imageModal = document.querySelector("[data-image-modal]");
let imageModalImg = document.querySelector("[data-image-modal-img]");
let imageCloseButtons = document.querySelectorAll("[data-image-close]");

if (intro) {
  body.classList.add("intro-lock");
}

const showPopup = () => {
  if (!popup || sessionStorage.getItem("plie-popup-closed") === "true") return;
  popup.classList.add("is-visible");
};

window.addEventListener("load", () => {
  if (intro) {
    window.setTimeout(() => {
      intro.classList.add("is-hidden");
      body.classList.remove("intro-lock");
    }, 1500);
  }

  window.setTimeout(showPopup, 2100);
});

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

popupCloseButtons.forEach((button) => {
  button.addEventListener("click", () => {
    popup?.classList.remove("is-visible");
    sessionStorage.setItem("plie-popup-closed", "true");
  });
});

if (year) {
  year.textContent = String(new Date().getFullYear());
}

const syncHeaderState = () => {
  header?.classList.toggle("scrolled", window.scrollY > 12);
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
    },
  );

  revealTargets.forEach((target) => observer.observe(target));
} else {
  revealTargets.forEach((target) => target.classList.add("is-visible"));
}

const closeImage = () => {
  if (!imageModal || !imageModalImg) return;
  imageModalImg.removeAttribute("src");
  imageModal.classList.remove("is-open");
  imageModal.setAttribute("aria-hidden", "true");
};

const wireImageCloseButtons = () => {
  imageCloseButtons.forEach((button) => {
    button.addEventListener("click", closeImage);
  });
};

const ensureImageModal = () => {
  if (imageModal && imageModalImg) return;
  imageModal = document.createElement("div");
  imageModal.className = "image-modal";
  imageModal.setAttribute("data-image-modal", "");
  imageModal.setAttribute("aria-hidden", "true");
  imageModal.innerHTML = `
    <div class="image-modal-backdrop" data-image-close></div>
    <div class="image-modal-dialog" role="dialog" aria-modal="true" aria-label="이미지 크게 보기">
      <button type="button" data-image-close aria-label="이미지 닫기">닫기</button>
      <img src="" alt="" data-image-modal-img />
    </div>
  `;
  document.body.appendChild(imageModal);
  imageModalImg = imageModal.querySelector("[data-image-modal-img]");
  imageCloseButtons = imageModal.querySelectorAll("[data-image-close]");
  wireImageCloseButtons();
};

wireImageCloseButtons();

imageOpenButtons.forEach((button) => {
  button.addEventListener("click", () => {
    ensureImageModal();
    if (!imageModal || !imageModalImg) return;
    const source = button.dataset.imageOpen;
    const label = button.getAttribute("aria-label") || "플리에 이미지";
    if (!source) return;
    imageModalImg.src = source;
    imageModalImg.alt = label;
    imageModal.classList.add("is-open");
    imageModal.setAttribute("aria-hidden", "false");
  });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeImage();
});
