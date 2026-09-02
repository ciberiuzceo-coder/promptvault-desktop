import { useEffect, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Store } from "@tauri-apps/plugin-store";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

type PromptTag = {
  id: string;
  name: string;
  color: string;
};

type PromptBlock = {
  id: string;
  text: string;
  tagId: string | null;
};

type PromptItem = {
  id: string;
  category: string;
  title: string;
  blocks: PromptBlock[];
  useCount: number;
};

const DEFAULT_CATEGORIES = ["Video/Motion", "Copywriting", "Imagenes", "Codigo"];

const DEFAULT_TAGS: PromptTag[] = [
  { id: "rol", name: "Rol", color: "#5B8DEF" },
  { id: "tarea", name: "Tarea", color: "#4CAF7D" },
  { id: "contexto", name: "Contexto", color: "#D9A441" },
  { id: "formato", name: "Formato", color: "#9B7EDE" },
];

const TAG_COLOR_PALETTE = [
  "#5B8DEF", "#4CAF7D", "#D9A441", "#9B7EDE",
  "#E2707A", "#3FA7A0", "#C97BDB", "#7A9CC6",
  "#B5C46A", "#E08E4F",
];

// Cambia esto por la URL de tu sitio una vez lo despliegues en la Fase 3
const SHARE_PAGE_BASE = "https://promptvault-share.netlify.app/";

const SEED_PROMPTS: PromptItem[] = [
  {
    id: crypto.randomUUID(),
    category: "Video/Motion",
    title: "Reel producto - ritmo dinamico",
    blocks: [
      {
        id: crypto.randomUUID(),
        text: "Edita este clip con cortes rapidos cada 0.8s, sincroniza con el beat, agrega zoom sutil en los cambios de escena.",
        tagId: null,
      },
    ],
    useCount: 0,
  },
  {
    id: crypto.randomUUID(),
    category: "Video/Motion",
    title: "Titulos animados",
    blocks: [
      {
        id: crypto.randomUUID(),
        text: "Genera un lower third minimalista con fade + slide de 300ms, tipografia sans bold.",
        tagId: null,
      },
    ],
    useCount: 0,
  },
];

let storePromise: Promise<Store> | null = null;
function getStore() {
  if (!storePromise) {
    storePromise = Store.load("prompts.json");
  }
  return storePromise;
}

function getFullText(blocks: PromptBlock[]): string {
  return blocks.map((b) => b.text).join("");
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Codifica el titulo y el texto del prompt para meterlos dentro del link
function encodePromptForShare(title: string, text: string): string {
  const json = JSON.stringify({ t: title, b: text });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Divide los fragmentos existentes segun el rango [start,end) y le asigna
// la etiqueta nueva a esa porcion, conservando el resto tal cual estaba.
function applyTagToRange(
  blocks: PromptBlock[],
  start: number,
  end: number,
  tagId: string | null
): PromptBlock[] {
  const result: PromptBlock[] = [];
  let pos = 0;
  for (const block of blocks) {
    const blockStart = pos;
    const blockEnd = pos + block.text.length;
    pos = blockEnd;

    if (blockEnd <= start || blockStart >= end) {
      result.push(block);
      continue;
    }

    const segments: { s: number; e: number; tag: string | null }[] = [];
    if (blockStart < start) segments.push({ s: blockStart, e: start, tag: block.tagId });
    const overlapStart = Math.max(blockStart, start);
    const overlapEnd = Math.min(blockEnd, end);
    segments.push({ s: overlapStart, e: overlapEnd, tag: tagId });
    if (blockEnd > end) segments.push({ s: end, e: blockEnd, tag: block.tagId });

    for (const seg of segments) {
      if (seg.e > seg.s) {
        result.push({
          id: crypto.randomUUID(),
          text: block.text.slice(seg.s - blockStart, seg.e - blockStart),
          tagId: seg.tag,
        });
      }
    }
  }
  return result;
}

// Calcula el offset de caracteres de la seleccion actual del mouse,
// relativo al contenedor dado.
function getSelectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const preRange = document.createRange();
  preRange.selectNodeContents(container);
  preRange.setEnd(range.startContainer, range.startOffset);
  const start = preRange.toString().length;
  const end = start + range.toString().length;
  return { start, end };
}

// Convierte un prompt guardado con el esquema viejo (campo "body")
// al esquema nuevo basado en fragmentos, si hace falta.
function migratePrompt(raw: any): PromptItem {
  if (raw.blocks) return raw as PromptItem;
  return {
    id: raw.id,
    category: raw.category,
    title: raw.title,
    blocks: [{ id: crypto.randomUUID(), text: raw.body ?? "", tagId: null }],
    useCount: raw.useCount ?? 0,
  };
}

function BlockText({ blocks, tags }: { blocks: PromptBlock[]; tags: PromptTag[] }) {
  return (
    <>
      {blocks.map((b) => {
        const tag = tags.find((t) => t.id === b.tagId);
        if (!tag) return <span key={b.id}>{b.text}</span>;
        return (
          <span
            key={b.id}
            style={{
              backgroundColor: hexToRgba(tag.color, 0.18),
              borderBottom: `1px solid ${tag.color}`,
            }}
          >
            {b.text}
          </span>
        );
      })}
    </>
  );
}

export default function App() {
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [tags, setTags] = useState<PromptTag[]>(DEFAULT_TAGS);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [activeCategory, setActiveCategory] = useState(DEFAULT_CATEGORIES[0]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sharedId, setSharedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // --- Flujo de creacion de prompt ---
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<"choose" | "paste-edit" | "paste-tag" | "create">("choose");
  const [newTitle, setNewTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [draftBlocks, setDraftBlocks] = useState<PromptBlock[]>([]);
  const [createFields, setCreateFields] = useState<{ tagId: string; value: string }[]>([]);
  const tagViewRef = useRef<HTMLDivElement>(null);

  // --- Menu contextual de etiquetas y modal de nueva etiqueta ---
  const [tagMenu, setTagMenu] = useState<{ x: number; y: number; start: number; end: number } | null>(null);
  const [tagModalContext, setTagModalContext] = useState<null | "paste" | "create">(null);
  const [pendingRange, setPendingRange] = useState<{ start: number; end: number } | null>(null);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLOR_PALETTE[0]);

  useEffect(() => {
    (async () => {
      const store = await getStore();

      const savedCategories = await store.get<string[]>("categories");
      const cats = savedCategories && savedCategories.length > 0 ? savedCategories : DEFAULT_CATEGORIES;
      setCategories(cats);
      setActiveCategory(cats[0]);
      if (!savedCategories) await store.set("categories", DEFAULT_CATEGORIES);

      const savedTags = await store.get<PromptTag[]>("tags");
      const allTags = savedTags && savedTags.length > 0 ? savedTags : DEFAULT_TAGS;
      setTags(allTags);
      if (!savedTags) await store.set("tags", DEFAULT_TAGS);

      const savedPrompts = await store.get<any[]>("prompts");
      if (savedPrompts && savedPrompts.length > 0) {
        setPrompts(savedPrompts.map(migratePrompt));
      } else {
        setPrompts(SEED_PROMPTS);
        await store.set("prompts", SEED_PROMPTS);
      }

      await store.save();
      setLoaded(true);
    })();
  }, []);

  async function persistPrompts(next: PromptItem[]) {
    setPrompts(next);
    const store = await getStore();
    await store.set("prompts", next);
    await store.save();
  }

  async function persistCategories(next: string[]) {
    setCategories(next);
    const store = await getStore();
    await store.set("categories", next);
    await store.save();
  }

  async function persistTags(next: PromptTag[]) {
    setTags(next);
    const store = await getStore();
    await store.set("tags", next);
    await store.save();
  }

  async function copyPrompt(prompt: PromptItem) {
    const text = getFullText(prompt.blocks).trim();
    await writeText(text);
    setCopiedId(prompt.id);
    const next = prompts.map((p) =>
      p.id === prompt.id ? { ...p, useCount: p.useCount + 1 } : p
    );
    persistPrompts(next);
    setTimeout(() => setCopiedId(null), 1200);
  }

  async function sharePrompt(prompt: PromptItem) {
    const text = getFullText(prompt.blocks).trim();
    const encoded = encodePromptForShare(prompt.title, text);
    const longUrl = `${SHARE_PAGE_BASE}?d=${encoded}`;
    let finalUrl = longUrl;

    try {
      const res = await tauriFetch(
        `https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}`
      );
      const shortText = (await res.text()).trim();
      if (shortText.startsWith("http")) finalUrl = shortText;
    } catch {
      // si falla el acortador, se copia el link largo igual
    }

    await writeText(finalUrl);
    setSharedId(prompt.id);
    setTimeout(() => setSharedId(null), 1500);
  }

  function deletePrompt(id: string) {
    persistPrompts(prompts.filter((p) => p.id !== id));
  }

  // --- Categorias ---
  function openAddCategory() {
    setNewCategoryName("");
    setShowCategoryModal(true);
  }

  function confirmAddCategory() {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return setShowCategoryModal(false);
    if (!categories.includes(trimmed)) {
      persistCategories([...categories, trimmed]);
    }
    setActiveCategory(trimmed);
    setShowCategoryModal(false);
  }

  // --- Flujo "Nuevo prompt" ---
  function openNewPromptFlow() {
    setShowForm(true);
    setFormMode("choose");
    setNewTitle("");
    setPasteText("");
    setDraftBlocks([]);
    setCreateFields(DEFAULT_TAGS.map((t) => ({ tagId: t.id, value: "" })));
  }

  function closeForm() {
    setShowForm(false);
    setFormMode("choose");
  }

  function goToTagging() {
    setDraftBlocks([{ id: crypto.randomUUID(), text: pasteText, tagId: null }]);
    setFormMode("paste-tag");
  }

  function backToEdit() {
    setPasteText(getFullText(draftBlocks));
    setFormMode("paste-edit");
  }

  function finalizeSave(blocks: PromptBlock[]) {
    if (!newTitle.trim() || blocks.length === 0) return;
    const item: PromptItem = {
      id: crypto.randomUUID(),
      category: activeCategory,
      title: newTitle.trim(),
      blocks,
      useCount: 0,
    };
    persistPrompts([item, ...prompts]);
    closeForm();
  }

  function saveFromPasteRaw() {
    finalizeSave([{ id: crypto.randomUUID(), text: pasteText, tagId: null }]);
  }

  function saveFromPasteTagged() {
    finalizeSave(draftBlocks);
  }

  function saveFromCreate() {
    const blocks = createFields
      .filter((f) => f.value.trim())
      .map((f) => ({
        id: crypto.randomUUID(),
        text: f.value.trim() + "\n\n",
        tagId: f.tagId,
      }));
    finalizeSave(blocks);
  }

  // --- Menu de etiquetas (clic derecho en modo Pegar) ---
  function handleTagContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const container = tagViewRef.current;
    if (!container) return;
    const offsets = getSelectionOffsets(container);
    if (!offsets || offsets.start === offsets.end) return;
    setTagMenu({ x: e.clientX, y: e.clientY, start: offsets.start, end: offsets.end });
  }

  function applyExistingTag(tagId: string) {
    if (tagMenu) {
      setDraftBlocks(applyTagToRange(draftBlocks, tagMenu.start, tagMenu.end, tagId));
    }
    setTagMenu(null);
  }

  function requestNewTagFromMenu() {
    if (tagMenu) setPendingRange({ start: tagMenu.start, end: tagMenu.end });
    setTagMenu(null);
    setNewTagName("");
    setNewTagColor(TAG_COLOR_PALETTE[0]);
    setTagModalContext("paste");
  }

  function requestNewTagFromCreateMode() {
    setNewTagName("");
    setNewTagColor(TAG_COLOR_PALETTE[0]);
    setTagModalContext("create");
  }

  function confirmCreateTag() {
    const trimmed = newTagName.trim();
    if (!trimmed) {
      setTagModalContext(null);
      return;
    }
    const tag: PromptTag = { id: crypto.randomUUID(), name: trimmed, color: newTagColor };
    persistTags([...tags, tag]);

    if (tagModalContext === "paste" && pendingRange) {
      setDraftBlocks(applyTagToRange(draftBlocks, pendingRange.start, pendingRange.end, tag.id));
    } else if (tagModalContext === "create") {
      setCreateFields([...createFields, { tagId: tag.id, value: "" }]);
    }
    setTagModalContext(null);
    setPendingRange(null);
  }

  const isSearching = search.trim().length > 0;

  const visible = isSearching
    ? prompts
        .filter((p) => p.title.toLowerCase().includes(search.trim().toLowerCase()))
        .sort((a, b) => b.useCount - a.useCount)
    : prompts
        .filter((p) => p.category === activeCategory)
        .sort((a, b) => b.useCount - a.useCount);

  if (!loaded) return null;

  return (
    <div className="panel">
      <div className="tabs">
        {categories.map((cat) => (
          <button
            key={cat}
            className={`tab ${activeCategory === cat && !isSearching ? "active" : ""}`}
            onClick={() => {
              setActiveCategory(cat);
              setSearch("");
            }}
          >
            {cat}
          </button>
        ))}
        <button className="tab tab-add" onClick={openAddCategory} title="Nueva categoria">
          +
        </button>
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder="Buscar por titulo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {isSearching && (
          <button className="clear-search" onClick={() => setSearch("")}>✕</button>
        )}
      </div>

      <div className="prompt-list">
        {visible.map((prompt) => (
          <div key={prompt.id} className="prompt-card" onClick={() => copyPrompt(prompt)}>
            <div className="prompt-header">
              <span className="prompt-title">
                {prompt.title}
                {isSearching && <span className="prompt-category-tag"> · {prompt.category}</span>}
              </span>
              <span
                className="delete-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  deletePrompt(prompt.id);
                }}
              >
                ✕
              </span>
              <span
                className="share-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  sharePrompt(prompt);
                }}
                title="Compartir"
              >
                {sharedId === prompt.id ? "✓" : "🔗"}
              </span>
              <span className="copy-icon">{copiedId === prompt.id ? "✓" : "⧉"}</span>
            </div>
            <div className="prompt-body">
              <BlockText blocks={prompt.blocks} tags={tags} />
            </div>
          </div>
        ))}

        {visible.length === 0 && (
          <div className="empty-state">
            {isSearching ? "Ningun prompt coincide con esa busqueda." : "Aun no hay prompts en esta categoria."}
          </div>
        )}

        {!isSearching && !showForm && (
          <button className="add-button" onClick={openNewPromptFlow}>
            + Nuevo prompt en {activeCategory}
          </button>
        )}

        {!isSearching && showForm && (
          <div className="new-prompt-form">
            <input
              placeholder="Titulo corto"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />

            {formMode === "choose" && (
              <div className="mode-choice">
                <button className="mode-btn" onClick={() => setFormMode("paste-edit")}>
                  📋 Pegar prompt existente
                </button>
                <button className="mode-btn" onClick={() => setFormMode("create")}>
                  ✏️ Crear prompt guiado
                </button>
              </div>
            )}

            {formMode === "paste-edit" && (
              <>
                <textarea
                  placeholder="Pega o escribe el prompt aqui..."
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={5}
                />
                <div className="form-actions">
                  <button className="save-btn" onClick={goToTagging} disabled={!pasteText.trim()}>
                    Etiquetar partes →
                  </button>
                  <button className="save-btn" onClick={saveFromPasteRaw} disabled={!pasteText.trim() || !newTitle.trim()}>
                    Guardar sin etiquetar
                  </button>
                </div>
              </>
            )}

            {formMode === "paste-tag" && (
              <>
                <div className="tag-hint">Selecciona una parte del texto y haz clic derecho para etiquetarla.</div>
                <div
                  className="tag-view"
                  ref={tagViewRef}
                  onContextMenu={handleTagContextMenu}
                >
                  <BlockText blocks={draftBlocks} tags={tags} />
                </div>
                <div className="form-actions">
                  <button className="cancel-btn" onClick={backToEdit}>← Volver a editar texto</button>
                  <button className="save-btn" onClick={saveFromPasteTagged} disabled={!newTitle.trim()}>
                    Guardar
                  </button>
                </div>
              </>
            )}

            {formMode === "create" && (
              <>
                {createFields.map((field, idx) => {
                  const tag = tags.find((t) => t.id === field.tagId);
                  return (
                    <div className="field-row" key={idx}>
                      <div className="field-label">
                        <span className="field-swatch" style={{ backgroundColor: tag?.color ?? "#888" }} />
                        {tag?.name ?? "Campo"}
                      </div>
                      <textarea
                        rows={2}
                        value={field.value}
                        onChange={(e) => {
                          const next = [...createFields];
                          next[idx] = { ...field, value: e.target.value };
                          setCreateFields(next);
                        }}
                      />
                    </div>
                  );
                })}
                <button className="add-field-btn" onClick={requestNewTagFromCreateMode}>
                  + Agregar campo personalizado
                </button>
                <div className="form-actions">
                  <button className="save-btn" onClick={saveFromCreate} disabled={!newTitle.trim()}>
                    Guardar
                  </button>
                </div>
              </>
            )}

            {formMode !== "choose" && (
              <button className="cancel-btn cancel-form" onClick={closeForm}>Cancelar</button>
            )}
          </div>
        )}
      </div>

      {/* Menu contextual para etiquetar texto seleccionado */}
      {tagMenu && (
        <>
          <div className="tag-menu-overlay" onClick={() => setTagMenu(null)} />
          <div className="tag-menu" style={{ left: tagMenu.x, top: tagMenu.y }}>
            {tags.map((tag) => (
              <div key={tag.id} className="tag-menu-item" onClick={() => applyExistingTag(tag.id)}>
                <span className="tag-menu-swatch" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </div>
            ))}
            <div className="tag-menu-item tag-menu-new" onClick={requestNewTagFromMenu}>
              + Nueva etiqueta
            </div>
          </div>
        </>
      )}

      {/* Modal para crear una etiqueta nueva */}
      {tagModalContext && (
        <div className="modal-overlay" onClick={() => setTagModalContext(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Nueva etiqueta</div>
            <input
              autoFocus
              className="modal-input"
              placeholder="Nombre de la etiqueta"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmCreateTag()}
            />
            <div className="color-palette">
              {TAG_COLOR_PALETTE.map((color) => (
                <button
                  key={color}
                  className={`color-swatch ${newTagColor === color ? "selected" : ""}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setNewTagColor(color)}
                />
              ))}
            </div>
            <div className="modal-actions">
              <button className="save-btn" onClick={confirmCreateTag}>Crear</button>
              <button className="cancel-btn" onClick={() => setTagModalContext(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para crear una categoria nueva */}
      {showCategoryModal && (
        <div className="modal-overlay" onClick={() => setShowCategoryModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Nueva categoria</div>
            <input
              autoFocus
              className="modal-input"
              placeholder="Nombre de la categoria"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmAddCategory();
                if (e.key === "Escape") setShowCategoryModal(false);
              }}
            />
            <div className="modal-actions">
              <button className="save-btn" onClick={confirmAddCategory}>Crear</button>
              <button className="cancel-btn" onClick={() => setShowCategoryModal(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}