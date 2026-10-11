/**
 * Full-screen pages (Settings, Location, Observe, Instruments…) with a back
 * stack, and the row widgets they're built from: switches, sliders, choice
 * lists, buttons. Rows read like iOS settings, styled like Stellarium Mobile.
 */
import { $, haptic } from "../state";

type Builder = (body: HTMLElement) => void | (() => void);
interface Frame { title: string; build: Builder; cleanup?: void | (() => void) }
const stack: Frame[] = [];

function show() {
  const top = stack[stack.length - 1];
  const page = $("page");
  if (!top) {
    page.hidden = true;
    return;
  }
  $("page-title").textContent = top.title;
  const body = $("page-body");
  body.innerHTML = "";
  body.scrollTop = 0;
  top.cleanup = top.build(body);
  page.hidden = false;
}

/** Push a page. Its builder fills the body and may return a cleanup. */
export function pushPage(title: string, build: Builder) {
  const top = stack[stack.length - 1];
  if (top?.cleanup) top.cleanup();
  stack.push({ title, build });
  show();
}

/** Replace the whole stack with one page (from the drawer). */
export function openPage(title: string, build: Builder) {
  closePages();
  pushPage(title, build);
}

export function popPage() {
  const top = stack.pop();
  if (top?.cleanup) top.cleanup();
  show();
}

export function closePages() {
  while (stack.length) stack.pop()?.cleanup?.();
  show();
}

/** Re-render the current page (after a change that alters its contents). */
export function refreshPage() {
  const top = stack[stack.length - 1];
  if (!top) return;
  top.cleanup?.();
  const y = $("page-body").scrollTop;
  show();
  $("page-body").scrollTop = y;
}

export function initPages() {
  $("page-back").addEventListener("click", popPage);
}

// ---------------------------------------------------------------- widgets
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export function section(body: HTMLElement, title: string, note?: string): HTMLElement {
  body.appendChild(el("h3", "", title));
  const box = el("div", "group");
  body.appendChild(box);
  if (note) body.appendChild(el("p", "caption group-note", note));
  return box;
}

export function switchRow(box: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void, sub?: string) {
  const b = el("button", "row switch-row" + (get() ? " on" : ""));
  b.innerHTML = `<span class="row-text"><span class="row-label"></span><span class="row-sub"></span></span><span class="track"></span>`;
  b.querySelector(".row-label")!.textContent = label;
  b.querySelector(".row-sub")!.textContent = sub ?? "";
  b.addEventListener("click", () => {
    set(!get());
    b.classList.toggle("on", get());
    haptic("light");
  });
  box.appendChild(b);
  return b;
}

export function sliderRow(
  box: HTMLElement,
  label: string,
  opts: { min: number; max: number; step: number; get: () => number; set: (v: number) => void; format: (v: number) => string },
) {
  const row = el("div", "row slider-row");
  row.innerHTML = `<div class="row-top"><span class="row-label"></span><span class="row-value"></span></div><input type="range">`;
  row.querySelector(".row-label")!.textContent = label;
  const input = row.querySelector("input")!;
  const value = row.querySelector(".row-value")!;
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.get());
  value.textContent = opts.format(opts.get());
  input.addEventListener("input", () => {
    const v = Number(input.value);
    opts.set(v);
    value.textContent = opts.format(v);
  });
  input.addEventListener("change", () => haptic("selection"));
  box.appendChild(row);
  return row;
}

/** A row that opens something (sub-page, action); shows a value on the right. */
export function navRow(box: HTMLElement, label: string, value: string, onClick: () => void, sub?: string) {
  const b = el("button", "row nav-row");
  b.innerHTML = `<span class="row-text"><span class="row-label"></span><span class="row-sub"></span></span><span class="row-value"></span><span class="chev">›</span>`;
  b.querySelector(".row-label")!.textContent = label;
  b.querySelector(".row-sub")!.textContent = sub ?? "";
  b.querySelector(".row-value")!.textContent = value;
  b.addEventListener("click", () => {
    haptic("light");
    onClick();
  });
  box.appendChild(b);
  return b;
}

/** A list of exclusive choices with a check mark. */
export function choiceList<T extends string>(
  box: HTMLElement,
  choices: { value: T; label: string; sub?: string }[],
  get: () => T,
  set: (v: T) => void,
) {
  const rows: HTMLButtonElement[] = [];
  for (const c of choices) {
    const b = el("button", "row choice-row");
    b.innerHTML = `<span class="row-text"><span class="row-label"></span><span class="row-sub"></span></span><span class="check">✓</span>`;
    b.querySelector(".row-label")!.textContent = c.label;
    b.querySelector(".row-sub")!.textContent = c.sub ?? "";
    b.classList.toggle("on", get() === c.value);
    b.addEventListener("click", () => {
      set(c.value);
      rows.forEach((r, i) => r.classList.toggle("on", choices[i].value === c.value));
      haptic("selection");
    });
    rows.push(b);
    box.appendChild(b);
  }
}

/** Segmented control (two to four options). */
export function segmented<T extends string>(box: HTMLElement, options: { value: T; label: string }[], get: () => T, set: (v: T) => void) {
  const wrap = el("div", "segmented");
  for (const o of options) {
    const b = el("button", get() === o.value ? "on" : "", o.label);
    b.addEventListener("click", () => {
      set(o.value);
      wrap.querySelectorAll("button").forEach((x, i) => x.classList.toggle("on", options[i].value === o.value));
      haptic("selection");
    });
    wrap.appendChild(b);
  }
  box.appendChild(wrap);
  return wrap;
}

export function buttonRow(box: HTMLElement, label: string, onClick: () => void, cls = "") {
  const b = el("button", "row button-row " + cls, label);
  b.addEventListener("click", () => {
    haptic("light");
    onClick();
  });
  box.appendChild(b);
  return b;
}

/** Labelled text/number input row. */
export function inputRow(box: HTMLElement, label: string, opts: { value: string; type?: string; placeholder?: string; onChange: (v: string) => void; inputmode?: string }) {
  const row = el("label", "row input-row");
  row.innerHTML = `<span class="row-label"></span><input>`;
  row.querySelector(".row-label")!.textContent = label;
  const input = row.querySelector("input")!;
  input.type = opts.type ?? "text";
  input.value = opts.value;
  input.placeholder = opts.placeholder ?? "";
  if (opts.inputmode) input.setAttribute("inputmode", opts.inputmode);
  input.autocomplete = "off";
  input.addEventListener("change", () => opts.onChange(input.value));
  box.appendChild(row);
  return input;
}

export { el };
