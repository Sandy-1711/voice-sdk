"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Next resets scroll on navigation only when the top of the changed route
 * segment sits outside the viewport. Both fumadocs layouts open with a sticky
 * header, so that check always passes and the previous scroll offset survives
 * the navigation.
 *
 * Back and forward are left alone, so the browser can restore its own position.
 */
export function ScrollToTop() {
  const pathname = usePathname();
  const restoring = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      restoring.current = true;
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (restoring.current) {
      restoring.current = false;
      return;
    }
    if (window.location.hash) return;

    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
