import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { useRef, useState } from "react";
import {
  Bold, Italic, Heading2, Heading3, List, ListOrdered,
  Quote, Link as LinkIcon, Image as ImageIcon, Undo, Redo, Loader2,
  Check, Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { cmsService } from "@/services/cmsService";
import { useToast } from "@/hooks/use-toast";

interface LinkPopover {
  open: boolean;
  top: number;
  left: number;
  value: string;
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

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer" } }),
      Image.configure({ HTMLAttributes: { class: "rounded-lg" } }),
      Placeholder.configure({ placeholder: "Write your post… use the toolbar to add headings, links, and images." }),
    ],
    content: content || "",
    editorProps: {
      attributes: {
        class:
          "prose prose-neutral dark:prose-invert max-w-none min-h-[360px] px-4 py-3 focus:outline-none " +
          "prose-headings:font-semibold prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-6 prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-4 " +
          "prose-a:text-primary prose-img:rounded-xl prose-img:my-6 prose-img:shadow-sm " +
          "prose-p:leading-[1.5] prose-headings:leading-[1.5] prose-li:leading-[1.5] prose-blockquote:leading-[1.5] prose-p:my-0",
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

  const handleImagePick = () => fileInputRef.current?.click();

  const handleImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking same file
    if (!file) return;
    setUploading(true);
    try {
      const url = await cmsService.uploadImage(file);
      editor.chain().focus().setImage({ src: url, alt: file.name }).run();
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
        <ToolbarButton title="Insert image" disabled={uploading} onClick={handleImagePick}>
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
    </div>
  );
}

export type { Editor };
