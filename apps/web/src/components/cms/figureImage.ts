import Image from "@tiptap/extension-image";

/**
 * Image node extended with a `caption`. When a caption is present it renders as
 *   <figure data-img-figure><img alt="…" /><figcaption>caption</figcaption></figure>
 * otherwise a plain <img>. Round-trips cleanly: figures (and legacy bare <img>)
 * are parsed back into the node so alt/caption stay editable. The public blog
 * (BlogContent) renders this HTML directly — DOMPurify keeps figure/figcaption.
 */
export const FigureImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: {
        default: null,
        // Caption is rendered by the node (figcaption), not as an <img> attribute.
        renderHTML: () => ({}),
        parseHTML: (element) => element.getAttribute("data-caption") || null,
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const caption = node.attrs.caption as string | null;
    if (caption) {
      return [
        "figure",
        { "data-img-figure": "" },
        ["img", HTMLAttributes],
        ["figcaption", {}, caption],
      ];
    }
    return ["img", HTMLAttributes];
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-img-figure]",
        getAttrs: (el) => {
          const node = el as HTMLElement;
          const img = node.querySelector("img");
          if (!img) return false;
          const cap = node.querySelector("figcaption");
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            title: img.getAttribute("title"),
            caption: cap?.textContent?.trim() || null,
          };
        },
      },
      { tag: "img[src]" },
    ];
  },
});
