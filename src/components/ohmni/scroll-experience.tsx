"use client";

import { useEffect, useRef } from "react";
import { ArrowUp } from "lucide-react";

export function ScrollExperience() {
  const progress = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const elements = Array.from(document.querySelectorAll<HTMLElement>(
      ".method-heading, .method-cards article, .showcase-card, .roadmap-step, .closing-cta",
    ));
    let observer: IntersectionObserver | undefined;
    if (!reduced.matches && "IntersectionObserver" in window) {
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer?.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08 });
      elements.forEach((element, i) => {
        element.style.setProperty("--reveal-delay", `${(i % 3) * 65}ms`);
        element.classList.add("scroll-reveal");
        if (element.getBoundingClientRect().top < window.innerHeight) element.classList.add("is-visible");
        else observer?.observe(element);
      });
    }
    // Keyboard focus must never land in visually concealed content.
    const revealFocus = (event: FocusEvent) => {
      if (event.target instanceof Element) event.target.closest(".scroll-reveal")?.classList.add("is-visible");
    };
    const disableMotion = () => {
      if (reduced.matches) {
        elements.forEach((element) => element.classList.add("is-visible"));
        observer?.disconnect();
      }
    };
    let frame = 0;
    const paint = () => {
      frame = 0;
      const extent = document.documentElement.scrollHeight - window.innerHeight;
      if (progress.current) progress.current.style.transform = `scaleX(${extent > 0 ? Math.min(1, Math.max(0, window.scrollY / extent)) : 0})`;
      if (back.current) back.current.hidden = window.scrollY < 700;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", revealFocus);
    reduced.addEventListener("change", disableMotion);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      elements.forEach((element) => element.classList.remove("scroll-reveal", "is-visible"));
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", revealFocus);
      reduced.removeEventListener("change", disableMotion);
    };
  }, []);

  return <>
    <div className="reading-progress" ref={progress} aria-hidden="true" />
    <button ref={back} hidden className="back-to-top" type="button" onClick={() => {
      window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      document.querySelector<HTMLElement>(".site-header a")?.focus({ preventScroll: true });
    }}><ArrowUp size={16} /> Back to top</button>
  </>;
}
