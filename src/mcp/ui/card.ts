import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";
import type { CardChip, CardStep, RecipeCard } from "../../recipes/recipe-card.js";

// The Smart Cooker MCP Apps view: one page for both upload_recipe (a recipe card) and list_recipes (a grid).
// It only paints the structuredContent the server built; every text goes in through textContent.

interface UploadView {
  kind: "upload";
  card: RecipeCard;
  upload: { status?: string; recipeUrl?: string; published: boolean; publishError?: string; thumbnailUrl?: string };
}

interface ListRecipe {
  id?: string;
  title?: string;
  status?: string;
  updatedAt?: string;
  stepCount?: number;
  ingredientCount?: number;
  recipeUrl?: string;
  thumbnailUrl?: string;
  emoji: string;
}

interface ListView {
  kind: "list";
  device: "mc" | "tm";
  total: number;
  /** Set when the list was filtered; `total` is then the whole account's count. */
  search?: string;
  recipes: ListRecipe[];
}

interface InvalidView {
  kind: "invalid";
  errors: string[];
}

type View = UploadView | ListView | InvalidView;

const root = document.getElementById("root") ?? document.body;
const app = new App({ name: "Smart Cooker", version: "1.0.0" }, {}, { autoResize: true });
let locale = "en";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function show(...nodes: Node[]): void {
  root.replaceChildren(...nodes);
}

function openLink(url: string | undefined): void {
  if (url) void app.openLink({ url });
}

function photo(node: HTMLElement, url: string | undefined): void {
  if (!url || !/^https:\/\//.test(url)) return;
  node.style.backgroundImage = `url("${url.replace(/["\\]/g, "")}")`;
  node.classList.add("photo");
}

function pill(item: CardChip, className = "pill"): HTMLElement {
  return el("span", className, `${item.icon} ${item.text}`);
}

function confetti(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = el("div", "confetti");
  const pieces = ["🎉", "✨", "🍅", "🥕", "🧄", "🌿", "🧀", "🍋"];
  for (let i = 0; i < 26; i += 1) {
    const piece = el("span", undefined, pieces[i % pieces.length]);
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    piece.style.fontSize = `${14 + Math.random() * 14}px`;
    layer.append(piece);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 3000);
}

function stepRow(step: CardStep): HTMLElement {
  const tone = step.mode?.tone ?? "manual";
  const mode = step.mode
    ? el(
      "div",
      "mode",
      el("span", "badge", `${step.mode.emoji} ${step.mode.label}`),
      ...step.mode.chips.map((item) => pill(item, "chip"))
    )
    : null;
  return el(
    "li",
    `step ${tone}`,
    el("div", "num", step.mode ? step.mode.emoji : String(step.n)),
    el(
      "div",
      undefined,
      el("div", "step-title", `${step.n}. ${step.title}`),
      step.text ? el("div", "step-text", step.text) : null,
      mode
    )
  );
}

function recipeBody(card: RecipeCard): HTMLElement {
  const body = el("div", "body");
  if (card.description) body.append(el("p", "description", card.description));
  body.append(el("div", "pills", ...card.metrics.map((item) => pill(item))));
  if (card.nutrients.length > 0) body.append(el("div", "pills", ...card.nutrients.map((item) => pill(item, "pill nutrient"))));

  body.append(el("h2", undefined, `🧺 ${card.labels.ingredients}`));
  const named = card.ingredientGroups.length > 1;
  for (const group of card.ingredientGroups) {
    if (named && group.name) body.append(el("div", "group-name", `🥣 ${group.name}`));
    const table = el("table", "ingredients");
    for (const item of group.items) {
      const quantity = [item.amount, item.unit].filter(Boolean).join(" ");
      table.append(
        el(
          "tr",
          item.optional ? "optional" : undefined,
          el("td", "qty", quantity),
          el("td", undefined, item.name, item.optional ? ` (${card.labels.optional})` : ""),
          el("td", "flag", item.weighed ? el("span", "weighed", "⚖️ scale") : null)
        )
      );
    }
    body.append(table);
  }

  body.append(el("h2", undefined, `👩‍🍳 ${card.labels.steps}`));
  body.append(el("ol", "steps", ...card.steps.map(stepRow)));
  return body;
}

function renderUpload(view: UploadView): void {
  const { card, upload } = view;
  const isTm = card.device === "tm";
  const banner = upload.published
    ? isTm
      ? el("div", "banner", el("span", "label", "✅ Saved to Cookidoo"), el("span", "sub", "appears on your Thermomix after it syncs"))
      : upload.status === "draft"
        ? el("div", "banner draft", el("span", "label", "📝 Saved as a web draft"), el("span", "sub", "not on the machine yet"))
        : el("div", "banner", el("span", "label", "📱 On your cooker!"), el("span", "sub", "under your created recipes"))
    : el("div", "banner warn", el("span", "label", "⚠️ Kept as a draft"), el("span", "sub", upload.publishError ?? ""));

  const hero = el("div", "hero", el("span", "emoji", card.emoji), el("h1", undefined, card.title));
  photo(hero, upload.thumbnailUrl);

  const body = recipeBody(card);
  if (upload.recipeUrl) {
    const button = el("button", "primary", isTm ? "Open in Cookidoo ↗" : "Open in Monsieur Cuisine ↗");
    button.addEventListener("click", () => openLink(upload.recipeUrl));
    body.append(el("div", "actions", button));
  }
  if (!upload.published) body.append(el("p", "note", "Fix it in the web editor and press the private-publish button."));

  show(el("article", "card", banner, hero, body));
  if (upload.published && upload.status !== "draft") confetti();
}

function relativeTime(value: string | undefined): string {
  if (!value) return "";
  const time = new Date(value.replace(" ", "T")).getTime();
  if (Number.isNaN(time)) return "";
  const minutes = Math.round((time - Date.now()) / 60_000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return format.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return format.format(days, "day");
  return format.format(Math.round(days / 30), "month");
}

function statusBadge(status: string | undefined): HTMLElement {
  if (status === "private-publish") return el("span", "status", "📱 On cooker");
  if (status === "draft") return el("span", "status draft", "📝 Draft");
  return el("span", "status other", status ?? "unknown");
}

function renderList(view: ListView): void {
  const head = el(
    "div",
    "grid-head",
    el("h1", undefined, view.device === "tm" ? "🍲 Your Cookidoo recipes" : "🍳 Your cooker's recipes"),
    el("span", "count", view.search
      ? `${view.recipes.length} match${view.recipes.length === 1 ? "" : "es"} for “${view.search}” (of ${view.total})`
      : view.recipes.length < view.total
        ? `showing ${view.recipes.length} of ${view.total}`
        : `${view.total} in total`)
  );
  if (view.recipes.length === 0) {
    show(head, el("p", "empty", view.search
      ? `No recipe matches “${view.search}”.`
      : "Nothing here yet — share a recipe link and I'll put it on your cooker."));
    return;
  }
  const tiles = view.recipes.map((recipe) => {
    const thumb = el("div", "thumb", recipe.thumbnailUrl ? "" : recipe.emoji);
    photo(thumb, recipe.thumbnailUrl);
    const counts = [
      recipe.stepCount !== undefined ? `👣 ${recipe.stepCount} steps` : "",
      recipe.ingredientCount !== undefined ? `🥕 ${recipe.ingredientCount} ingredients` : ""
    ].filter(Boolean).join(" · ");
    const updated = relativeTime(recipe.updatedAt);
    const tile = el(
      "button",
      "tile",
      thumb,
      el(
        "div",
        "info",
        el("div", "name", recipe.title ?? "Untitled"),
        statusBadge(recipe.status),
        el("div", "meta", [updated && `🕒 ${updated}`, counts].filter(Boolean).join(" · "))
      )
    );
    tile.addEventListener("click", () => openLink(recipe.recipeUrl));
    return tile;
  });
  show(head, el("div", "grid", ...tiles));
}

function renderInvalid(view: InvalidView): void {
  show(
    el(
      "div",
      "card",
      el(
        "div",
        "message",
        el("strong", undefined, "🧑‍🍳 Adjusting the recipe for your machine…"),
        `${view.errors.length} setting${view.errors.length === 1 ? "" : "s"} need fixing before it can be sent.`
      )
    )
  );
}

function renderPending(title: string): void {
  show(
    el(
      "div",
      "card",
      el("div", "banner pending", el("div", "spinner"), `Sending “${title}” to your cooker…`)
    )
  );
}

function renderMessage(text: string): void {
  show(el("div", "card", el("div", "message", el("strong", undefined, "⚠️ Something went wrong"), text.slice(0, 400))));
}

function isView(value: unknown): value is View {
  return typeof value === "object" && value !== null && "kind" in value &&
    ["upload", "list", "invalid"].includes(String((value as { kind: unknown }).kind));
}

function render(view: View): void {
  switch (view.kind) {
    case "upload":
      renderUpload(view);
      break;
    case "list":
      renderList(view);
      break;
    case "invalid":
      renderInvalid(view);
      break;
    default: {
      const unreachable: never = view;
      return unreachable;
    }
  }
}

function applyTheme(theme: string | undefined): void {
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
}

app.onhostcontextchanged = (context) => {
  applyTheme(context.theme);
  if (context.locale) locale = context.locale;
};

app.ontoolinput = ({ arguments: args }) => {
  const recipe = args?.recipe;
  const title = typeof recipe === "object" && recipe !== null && "title" in recipe ? String((recipe as { title: unknown }).title) : "";
  if (title) renderPending(title);
};

app.ontoolresult = (result) => {
  const view = result.structuredContent;
  if (isView(view)) {
    render(view);
    return;
  }
  // A running job (finished via job_status) or an error: show what the tool said, briefly.
  const first = result.content?.find((item) => item.type === "text");
  const text = first && "text" in first ? String(first.text) : "";
  if (text.includes("\"status\": \"running\"")) renderPending("your recipe");
  else renderMessage(text);
};

void app.connect().then(() => {
  const context = app.getHostContext();
  applyTheme(context?.theme);
  if (context?.locale) locale = context.locale;
});
