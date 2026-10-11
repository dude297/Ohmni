"use client";

import { useEffect } from "react";

/** Subtle one-time reveal for homepage cards. Content stays visible without JS or with reduced motion. */
export function ScrollExperience() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches || !("IntersectionObserver" in window)) return;
    const elements = Array.from(document.querySelectorAll<HTMLElement>(
      ".method-cards article, .showcase-card, .roadmap-step, .audience-item",
    ));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    elements.forEach((element, i) => {
      element.style.setProperty("--reveal-delay", `${(i % 3) * 65}ms`);
      element.classList.add("scroll-reveal");
      if (element.getBoundingClientRect().top < window.innerHeight) element.classList.add("is-visible");
      else observer.observe(element);
    });
    // Keyboard focus must never land in visually concealed content.
    const revealFocus = (event: FocusEvent) => {
      if (event.target instanceof Element) event.target.closest(".scroll-reveal")?.classList.add("is-visible");
    };
    const disableMotion = () => {
      if (reduced.matches) elements.forEach((element) => element.classList.add("is-visible"));
    };
    document.addEventListener("focusin", revealFocus);
    reduced.addEventListener("change", disableMotion);
    return () => {
      observer.disconnect();
      elements.forEach((element) => element.classList.remove("scroll-reveal", "is-visible"));
      document.removeEventListener("focusin", revealFocus);
      reduced.removeEventListener("change", disableMotion);
    };
  }, []);
  return null;
}
