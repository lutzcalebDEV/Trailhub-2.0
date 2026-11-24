// Vale Trails — action sheets, as iPhone apps ask things: choices that slide up from the
// bottom with Cancel apart (a small centred box on a computer). Used instead of the
// browser's own pop-ups.
//
//   if (await confirmSheet({ title: "Delete Oak ladder?", message: "…", action: "Delete" })) …
//   const picked = await chooseSheet({ title: "Oak ladder", options: [{ value, label, danger }] });
let open = null;

export function chooseSheet({ title, message, options, cancel = "Cancel" }) {
  if (open) open(null);
  return new Promise((resolve) => {
    const before = document.activeElement;
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      n.className = cls;
      if (text) n.textContent = text; // may hold names people typed, so never as HTML
      return n;
    };
    const wrap = el("div", "asksheet");
    const box = el("div", "asksheet__box");
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", title || "Choose");
    const group = el("div", "asksheet__group");
    if (title || message) {
      const head = el("div", "asksheet__head");
      if (title) head.append(el("b", "", title));
      if (message) head.append(el("span", "", message));
      group.append(head);
    }
    const buttons = options.map((o) => {
      const b = el("button", "asksheet__btn" + (o.danger ? " is-danger" : ""), o.label);
      b.type = "button";
      b.addEventListener("click", () => finish(o.value));
      group.append(b);
      return b;
    });
    const no = el("button", "asksheet__btn asksheet__cancel", cancel);
    no.type = "button";
    no.addEventListener("click", () => finish(null));
    box.append(group, no);
    wrap.append(box);
    document.body.append(wrap);

    let done = false;
    function finish(value) {
      if (done) return;
      done = true;
      open = null;
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("popstate", onPop);
      wrap.classList.remove("is-in");
      const gone = () => wrap.remove();
      box.addEventListener("transitionend", gone, { once: true });
      setTimeout(gone, 350);
      if (before && before.isConnected && before.focus) before.focus({ preventScroll: true });
      resolve(value);
    }
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); finish(null); return; }
      if (e.key !== "Tab") return;
      // Tab stays inside the sheet.
      const all = [...buttons, no], i = all.indexOf(document.activeElement);
      e.preventDefault();
      all[(i + (e.shiftKey ? all.length - 1 : 1)) % all.length].focus();
    };
    const onPop = () => finish(null);
    open = finish;
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("popstate", onPop);
    wrap.addEventListener("click", (e) => { if (e.target === wrap) finish(null); });
    requestAnimationFrame(() => requestAnimationFrame(() => { wrap.classList.add("is-in"); no.focus({ preventScroll: true }); }));
  });
}

export const confirmSheet = ({ title, message, action = "Delete", danger = true }) =>
  chooseSheet({ title, message, options: [{ value: true, label: action, danger }] }).then((v) => v === true);
