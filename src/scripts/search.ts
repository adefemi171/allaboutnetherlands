// Behaviour for every search box on the page (see components/Search.astro).

interface Entry {
  type: "guide" | "place" | "address";
  title: string;
  /** Other names to match, such as the English name of a city. */
  also: string;
  detail: string;
  tag: string;
  url: string;
  /** Place id, for results that can be shown on the map. */
  id?: string;
  /** Position of a street or an address on the Dutch national grid, metres. */
  rd?: [number, number];
}

// Streets and addresses come from the Locatieserver of PDOK, the Dutch
// government's map service. Only the search box on the map asks it.
const ADDRESS_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest";
const ADDRESS_TAGS: Record<string, string> = {
  weg: "Street",
  adres: "Address",
  postcode: "Postcode",
  woonplaats: "Town",
};

async function findAddresses(query: string, signal: AbortSignal): Promise<Entry[]> {
  const url =
    `${ADDRESS_URL}?q=${encodeURIComponent(query)}&rows=5` +
    "&fl=weergavenaam,type,centroide_rd" +
    `&fq=${encodeURIComponent("type:(weg OR adres OR postcode OR woonplaats)")}`;
  const response = await fetch(url, { signal });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    response?: { docs?: { weergavenaam?: string; type?: string; centroide_rd?: string }[] };
  };
  const found: Entry[] = [];
  for (const doc of data.response?.docs ?? []) {
    // "POINT(121828.874 486751.728)"
    const point = /\(\s*([\d.]+)\s+([\d.]+)\s*\)/.exec(doc.centroide_rd ?? "");
    if (!doc.weergavenaam || !point) continue;
    const comma = doc.weergavenaam.indexOf(",");
    found.push({
      type: "address",
      title: comma < 0 ? doc.weergavenaam : doc.weergavenaam.slice(0, comma),
      also: "",
      detail: comma < 0 ? "" : doc.weergavenaam.slice(comma + 1).trim(),
      tag: ADDRESS_TAGS[doc.type ?? ""] ?? "Place",
      url: "#",
      rd: [Number(point[1]), Number(point[2])],
    });
  }
  return found;
}

let index: Promise<Entry[]> | null = null;
function loadIndex(): Promise<Entry[]> {
  index ??= fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/search.json`)
    .then((response) => (response.ok ? response.json() : []))
    .catch(() => []);
  return index;
}

function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .toLowerCase();
}

function score(entry: Entry, query: string): number {
  const title = plain(`${entry.title} ${entry.also}`);
  if (title.startsWith(query)) return 4;
  if (title.split(/[\s-]+/).some((word) => word.startsWith(query))) return 3;
  if (title.includes(query)) return 2;
  if (plain(entry.detail).includes(query)) return 1;
  return 0;
}

function setup(root: HTMLElement): void {
  const field = root.querySelector<HTMLInputElement>(".search__field");
  const list = root.querySelector<HTMLUListElement>(".search__results");
  if (!field || !list) return;

  let active = -1;
  let shown: Entry[] = [];

  // Streets and addresses, where the box offers them.
  const addresses = root.dataset.searchAddresses !== undefined;
  let local: Entry[] = [];
  let remote: Entry[] = [];
  /** The text the remote results belong to. */
  let remoteFor = "";
  let looking = false;
  let timer = 0;
  let lookup: AbortController | null = null;

  const close = () => {
    list.hidden = true;
    field.setAttribute("aria-expanded", "false");
    field.removeAttribute("aria-activedescendant");
    active = -1;
  };

  const highlight = (next: number) => {
    const items = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    if (!items.length) return;
    active = (next + items.length) % items.length;
    items.forEach((item, k) =>
      item.setAttribute("aria-selected", String(k === active)),
    );
    field.setAttribute("aria-activedescendant", items[active].id);
    items[active].scrollIntoView({ block: "nearest" });
  };

  const go = (entry: Entry, event?: Event) => {
    if (entry.rd) {
      event?.preventDefault();
      const handled = !window.dispatchEvent(
        new CustomEvent("aan:address", {
          detail: {
            title: entry.detail ? `${entry.title}, ${entry.detail}` : entry.title,
            rd: entry.rd,
          },
          cancelable: true,
        }),
      );
      if (handled) {
        field.value = entry.title;
        close();
        field.blur();
      }
      return;
    }
    // On the map page a place result moves the map instead of reloading it.
    if (entry.id) {
      const handled = !window.dispatchEvent(
        new CustomEvent("aan:place", { detail: entry.id, cancelable: true }),
      );
      if (handled) {
        event?.preventDefault();
        field.value = entry.title;
        close();
        field.blur();
        return;
      }
    }
    if (!event) window.location.href = entry.url;
  };

  const render = async () => {
    const query = plain(field.value.trim());
    if (!query) return close();
    const entries = await loadIndex();
    // The field may have changed while the index was loading.
    if (plain(field.value.trim()) !== query) return;
    local = entries
      .map((entry) => ({ entry, rank: score(entry, query) }))
      .filter((scored) => scored.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, addresses ? 5 : 8)
      .map((scored) => scored.entry);
    draw();
    if (addresses) lookUp(field.value.trim());
  };

  /** Ask for streets and addresses once the typing pauses. */
  const lookUp = (text: string) => {
    window.clearTimeout(timer);
    lookup?.abort();
    looking = false;
    if (text === remoteFor) return;
    remote = [];
    remoteFor = "";
    if (text.length < 3) return;
    looking = true;
    draw();
    timer = window.setTimeout(async () => {
      lookup = new AbortController();
      let found: Entry[] = [];
      try {
        found = await findAddresses(text, lookup.signal);
      } catch (error) {
        // Typed on, or the service is down. The local results stand.
        if ((error as Error).name === "AbortError") return;
      }
      if (field.value.trim() !== text) return;
      remote = found;
      remoteFor = text;
      looking = false;
      draw();
    }, 250);
  };

  const draw = () => {
    const selected = active;
    shown = [...local, ...(remoteFor === field.value.trim() ? remote : [])];

    list.replaceChildren();
    if (!shown.length) {
      const empty = document.createElement("li");
      empty.className = "search__empty";
      empty.textContent = looking
        ? "Looking for streets and addresses"
        : addresses
          ? "Nothing found. Try a city, a street with a house number, or a postcode."
          : "Nothing found. Try a city, or a word like “BSN”.";
      list.append(empty);
    }
    shown.forEach((entry, k) => {
      const item = document.createElement("li");
      item.id = `${list.id}-${k}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      const link = document.createElement("a");
      link.href = entry.url;
      link.tabIndex = -1;
      const title = document.createElement("span");
      title.textContent = entry.title;
      const tag = document.createElement("span");
      tag.className = "mono";
      tag.textContent = entry.tag;
      const detail = document.createElement("small");
      detail.textContent = entry.detail;
      link.append(title, tag, detail);
      link.addEventListener("click", (event) => go(entry, event));
      item.append(link);
      list.append(item);
    });
    if (addresses) {
      const note = document.createElement("li");
      note.className = "search__note";
      note.setAttribute("role", "presentation");
      note.textContent = "Streets and addresses are looked up at PDOK, the Dutch government’s map service.";
      list.append(note);
    }
    list.hidden = false;
    field.setAttribute("aria-expanded", "true");
    active = -1;
    // Results that arrive later are added below, so the choice stands.
    if (selected >= 0 && selected < shown.length) highlight(selected);
  };

  field.addEventListener("focus", () => {
    loadIndex();
    if (field.value.trim()) render();
  });
  field.addEventListener("input", render);
  field.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (list.hidden) render();
      else highlight(active + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlight(active - 1);
    } else if (event.key === "Enter") {
      const entry = shown[active < 0 ? 0 : active];
      if (!list.hidden && entry) {
        event.preventDefault();
        go(entry);
      }
    } else if (event.key === "Escape") {
      if (list.hidden) field.blur();
      else close();
    }
  });
  root.addEventListener("focusout", (event) => {
    if (!root.contains(event.relatedTarget as Node | null)) close();
  });
  // Keep focus in the field when a result is pressed, so the click lands.
  list.addEventListener("pointerdown", (event) => event.preventDefault());
}

document.querySelectorAll<HTMLElement>("[data-search]").forEach((root) => {
  if (root.dataset.searchReady) return;
  root.dataset.searchReady = "true";
  setup(root);
});

// "/" jumps to the first search box that is on screen.
if (!document.documentElement.dataset.searchKey) {
  document.documentElement.dataset.searchKey = "true";
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable]")) return;
    const field = [...document.querySelectorAll<HTMLInputElement>(".search__field")].find(
      (candidate) => candidate.offsetParent !== null,
    );
    if (field) {
      event.preventDefault();
      field.focus();
    }
  });
}
