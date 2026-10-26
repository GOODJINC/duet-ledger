// One shared lock for nested dialogs. Preserve the page position and inline styles.
let count = 0;
let restore: (() => void) | undefined;
export function lockPageScroll() {
  if (count++ === 0) {
    const x = window.scrollX,
      y = window.scrollY;
    const changes: [HTMLElement, string, string][] = [
      [document.documentElement, "overflow", "hidden"],
      [document.body, "position", "fixed"],
      [document.body, "top", `${-y}px`],
      [document.body, "left", `${-x}px`],
      [document.body, "right", "0"],
      [document.body, "width", "100%"],
      [document.body, "overflow", "hidden"],
    ];
    const previous = changes.map(([node, property, value]) => {
      const old = node.style.getPropertyValue(property);
      const priority = node.style.getPropertyPriority(property);
      node.style.setProperty(property, value);
      return () =>
        old
          ? node.style.setProperty(property, old, priority)
          : node.style.removeProperty(property);
    });
    restore = () => {
      previous.reverse().forEach((undo) => undo());
      if (x || y) window.scrollTo(x, y);
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--count === 0) {
      restore?.();
      restore = undefined;
    }
  };
}
