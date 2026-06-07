import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useRef, useState } from "react";
import {
  Bold, Italic, Heading2, Heading3, List, ListOrdered,
  Quote, Link as LinkIcon, Image as ImageIcon, Undo, Redo, Loader2,
  Check, Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cmsService } from "@/services/cmsService";
import { useToast } from "@/hooks/use-toast";
import { FigureImage } from "@/components/cms/figureImage";

interface LinkPopover {
  open: boolean;
  top: number;
  left: number;
  value: string;
}

interface ImagePopover {
  open: boolean;
  top: number;
  left: number;
  mode: "insert" | "edit";
  src: string;
  alt: string;
  caption: string;
}

interface RichTextEditorProps {
  /** Initial HTML content. */
  content: string;
  onChange: (html: string, json: Record<string, unknown>) => void;
}

const ToolbarButton = ({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    disabled={disabled}
    className={cn(
      "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40",
      active && "bg-primary/10 text-primary",
    )}
  >
    {children}
  </button>
);

export default function RichTextEditor({ content, onChange }: RichTextEditorProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [linkPopover, setLinkPopover] = useState<LinkPopover>({ open: false, top: 0, left: 0, value: "" });
  const [imagePopover, setImagePopover] = useState<ImagePopover>({ open: false, top: 0, left: 0, mode: "insert", src: "", alt: "", caption: "" });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer" } }),
      FigureImage.configure({ HTMLAttributes: { class: "rounded-lg" } }),
      Placeholder.configure({ placeholder: "Write your post… use the toolbar to add headings, links, and images." }),
    ],
    content: content || "",
    editorProps: {
      attributes: {
        class:
          "prose prose-neutral dark:prose-invert max-w-none min-h-[360px] px-4 py-3 focus:outline-none " +
          "prose-headings:font-semibold prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-6 prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-4 " +
          "prose-a:text-primary prose-img:rounded-xl prose-img:my-6 prose-img:shadow-sm prose-img:cursor-pointer " +
          "prose-figure:my-6 [&_figure_img]:my-0 prose-figcaption:mt-2 prose-figcaption:text-center " +
          "prose-p:leading-[1.5] prose-headings:leading-[1.5] prose-li:leading-[1.5] prose-blockquote:leading-[1.5] prose-p:my-0",
      },
      // Click an existing image (incl. legacy images in old posts) to edit its
      // alt text + caption. ProseMirror also selects the node, so applyImage's
      // updateAttributes targets it.
      handleClickOn: (view, _pos, node, nodePos) => {
        if (node.type.name === "image") {
          const coords = view.coordsAtPos(nodePos);
          setImagePopover({
            open: true,
            top: coords.bottom + 6,
            left: coords.left,
            mode: "edit",
            src: (node.attrs.src as string) ?? "",
            alt: (node.attrs.alt as string) ?? "",
            caption: (node.attrs.caption as string) ?? "",
          });
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML(), editor.getJSON() as Record<string, unknown>),
  });

  if (!editor) return null;

  const openLinkPopover = () => {
    // Position the popover just below the start of the current selection,
    // using editor coords (independent of DOM focus when the input takes over).
    const { from } = editor.state.selection;
    const coords = editor.view.coordsAtPos(from);
    const previous = (editor.getAttributes("link").href as string | undefined) ?? "";
    setLinkPopover({
      open: true,
      top: coords.bottom + 6,
      left: coords.left,
      value: previous || "https://",
    });
  };

  const closeLinkPopover = () => {
    setLinkPopover((p) => ({ ...p, open: false }));
    editor.chain().focus().run();
  };

  const applyLink = () => {
    const url = linkPopover.value.trim();
    if (!url || url === "https://") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkPopover((p) => ({ ...p, open: false }));
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkPopover((p) => ({ ...p, open: false }));
  };

  const popoverCoords = () => {
    const { from } = editor.state.selection;
    const coords = editor.view.coordsAtPos(from);
    return { top: coords.bottom + 6, left: coords.left };
  };

  // Image button: edit the selected image's alt/caption, or pick a file to insert.
  const onImageButton = () => {
    if (editor.isActive("image")) {
      const attrs = editor.getAttributes("image");
      setImagePopover({
        open: true,
        ...popoverCoords(),
        mode: "edit",
        src: attrs.src ?? "",
        alt: attrs.alt ?? "",
        caption: attrs.caption ?? "",
      });
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking same file
    if (!file) return;
    setUploading(true);
    try {
      const url = await cmsService.uploadImage(file);
      // Open the popover so the author can set alt text + caption before inserting.
      setImagePopover({
        open: true,
        ...popoverCoords(),
        mode: "insert",
        src: url,
        alt: file.name.replace(/\.[^.]+$/, ""),
        caption: "",
      });
    } catch (err) {
      toast({
        title: "Image upload failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const applyImage = () => {
    const alt = imagePopover.alt.trim() || null;
    const caption = imagePopover.caption.trim() || null;
    if (imagePopover.mode === "insert") {
      editor.chain().focus().insertContent({
        type: "image",
        attrs: { src: imagePopover.src, alt, caption },
      }).run();
    } else {
      editor.chain().focus().updateAttributes("image", { alt, caption }).run();
    }
    setImagePopover((p) => ({ ...p, open: false }));
  };

  const closeImagePopover = () => {
    setImagePopover((p) => ({ ...p, open: false }));
    editor.chain().focus().run();
  };

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="sticky top-[60px] z-10 flex flex-wrap items-center gap-1 rounded-t-lg border-b border-border bg-background px-2 py-1.5">
        <ToolbarButton title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton title="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="h-4 w-4" />
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton title="Link" active={editor.isActive("link")} onClick={openLinkPopover}>
          <LinkIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Image — insert, or edit alt text & caption" active={editor.isActive("image")} disabled={uploading} onClick={onImageButton}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton title="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton title="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo className="h-4 w-4" />
        </ToolbarButton>
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageSelected} />
      </div>
      <EditorContent editor={editor} />

      {linkPopover.open && (
        <>
          {/* click-outside backdrop */}
          <div className="fixed inset-0 z-40" onMouseDown={closeLinkPopover} />
          <div
            className="fixed z-50 flex items-center gap-1.5 rounded-lg border border-border bg-popover p-1.5 shadow-lg"
            style={{ top: linkPopover.top, left: linkPopover.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Input
              autoFocus
              value={linkPopover.value}
              onChange={(e) => setLinkPopover((p) => ({ ...p, value: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); applyLink(); }
                if (e.key === "Escape") { e.preventDefault(); closeLinkPopover(); }
              }}
              placeholder="https://example.com"
              className="h-8 w-64 text-sm"
            />
            <button
              type="button"
              title="Apply link"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyLink}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Check className="h-4 w-4" />
            </button>
            {editor.isActive("link") && (
              <button
                type="button"
                title="Remove link"
                onMouseDown={(e) => e.preventDefault()}
                onClick={removeLink}
                className="flex h-8 w-8 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10"
              >
                <Unlink className="h-4 w-4" />
              </button>
            )}
          </div>
        </>
      )}

      {imagePopover.open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={closeImagePopover} />
          <div
            className="fixed z-50 w-80 rounded-lg border border-border bg-popover p-3 shadow-lg"
            style={{ top: imagePopover.top, left: imagePopover.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-xs font-semibold text-foreground">
              {imagePopover.mode === "insert" ? "Insert image" : "Edit image"}
            </div>
            {imagePopover.src && (
              <img src={imagePopover.src} alt="" className="mb-3 max-h-28 w-full rounded-md object-cover" />
            )}
            <div className="space-y-2">
              <div className="space-y-1">
                <Label htmlFor="img-alt" className="text-xs">Alt text (for SEO & accessibility)</Label>
                <Input
                  id="img-alt"
                  autoFocus
                  value={imagePopover.alt}
                  onChange={(e) => setImagePopover((p) => ({ ...p, alt: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Escape") closeImagePopover(); }}
                  placeholder="Describe the image"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="img-caption" className="text-xs">Caption (shown below the image)</Label>
                <Input
                  id="img-caption"
                  value={imagePopover.caption}
                  onChange={(e) => setImagePopover((p) => ({ ...p, caption: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyImage(); } if (e.key === "Escape") closeImagePopover(); }}
                  placeholder="Optional caption"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={closeImagePopover} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={applyImage}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Check className="h-4 w-4" />
                {imagePopover.mode === "insert" ? "Insert" : "Save"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export type { Editor };
