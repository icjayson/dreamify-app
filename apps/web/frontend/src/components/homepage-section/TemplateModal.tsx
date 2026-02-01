import React, { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";

interface TemplateModalProps {
  open: boolean;
  onClose: () => void;
  onTemplateSelect: (template: Template) => void;
}

interface Template {
  id: string;
  title: string;
  description: string;
  image: string;
  category: string;
}

const TemplateModal: React.FC<TemplateModalProps> = ({ open, onClose, onTemplateSelect }) => {
  const [dragY, setDragY] = useState(0);
  const draggingRef = useRef(false);
  const startYRef = useRef<number | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // Responsive: detect desktop to avoid mounting mobile Sheet overlay on desktop
  const [isDesktop, setIsDesktop] = useState<boolean>(false);

  useEffect(() => {
    const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 640px)') : null;
    const update = () => setIsDesktop(!!mq && mq.matches);
    update();
    if (mq) {
      try {
        mq.addEventListener('change', update);
      } catch {
        // Safari fallback
        // @ts-ignore
        mq.addListener(update);
      }
    }
    return () => {
      if (mq) {
        try {
          mq.removeEventListener('change', update);
        } catch {
          // @ts-ignore
          mq.removeListener(update);
        }
      }
    };
  }, []);

  // Mobile two-sheet state
  const [isShowingMobileContent, setIsShowingMobileContent] = useState(false);

  // Reset mobile flow on open
  useEffect(() => {
    if (open) {
      const isDesktopOrUp = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(min-width: 640px)').matches;
      setDragY(0);
      // On mobile (< sm), open directly into the content sheet for the selected tab
      setIsShowingMobileContent(!isDesktopOrUp);
    } else {
      setIsShowingMobileContent(false);
      setDragY(0);
    }
  }, [open]);

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    startYRef.current = e.clientY;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { }
  };

  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || startYRef.current == null) return;
    const delta = e.clientY - startYRef.current;
    setDragY(delta > 0 ? delta : 0);
  };

  const onHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (dragY > 100) {
      onClose();
    }
    setDragY(0);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { }
  };

  // Hardcoded template data
  const templates: Template[] = [
    {
      id: "1",
      title: "Sales Dashboard",
      description: "Track sales performance, revenue trends, and conversion metrics",
      image: "/template-demo-1.png",
      category: "Sales"
    },
    {
      id: "2",
      title: "Marketing Analytics",
      description: "Monitor campaign performance, user acquisition, and engagement",
      image: "/template-demo-2.png",
      category: "Marketing"
    },
    {
      id: "3",
      title: "Financial Overview",
      description: "Analyze revenue, expenses, and financial health indicators",
      image: "/template-demo-3.png",
      category: "Finance"
    },
    {
      id: "4",
      title: "Customer Insights",
      description: "Understand customer behavior, satisfaction, and retention",
      image: "/template-demo-4.jpeg",
      category: "Customer"
    },
    {
      id: "5",
      title: "Operations Metrics",
      description: "Monitor operational efficiency and key performance indicators",
      image: "/template-demo-5.png",
      category: "Operations"
    },
    {
      id: "6",
      title: "Product Analytics",
      description: "Track product usage, feature adoption, and user engagement",
      image: "/template-demo-6.jpeg",
      category: "Product"
    },
    {
      id: "7",
      title: "Revenue Tracking",
      description: "Monitor revenue streams, growth rates, and profitability",
      image: "/template-demo-7.jpeg",
      category: "Revenue"
    },
    {
      id: "8",
      title: "User Engagement",
      description: "Analyze user activity, session data, and engagement patterns",
      image: "/template-demo-8.jpeg",
      category: "Engagement"
    },
    {
      id: "9",
      title: "Performance Monitor",
      description: "Track system performance, uptime, and technical metrics",
      image: "/template-demo-9.jpg",
      category: "Performance"
    }
  ];

  const handleTemplateClick = (template: Template) => {
    if (selectedTemplate?.id === template.id) {
      // If clicking on already selected template, unselect it
      setSelectedTemplate(null);
    } else {
      // Otherwise, select the template
      setSelectedTemplate(template);
    }
  };

  const handleConfirmClick = () => {
    if (selectedTemplate) {
      onTemplateSelect(selectedTemplate);
      onClose();
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Mobile: Single Sheet (sm:hidden) */}
      {open && !isDesktop && (
        <Sheet open={open} onOpenChange={(v) => { if (!v) { setIsShowingMobileContent(false); onClose(); } }}>
          <SheetContent side="bottom" className="sm:hidden h-[80vh] w-full bg-muted border-t border-border rounded-t-2xl overflow-hidden p-0">
            {/* Drag Handle */}
            <div
              className="w-full flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing select-none"
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
            >
              <div className="h-1.5 w-12 rounded-full bg-white/20" />
            </div>
            {/* Content with drag translate */}
            <div style={{ transform: `translateY(${dragY}px)`, transition: draggingRef.current ? 'none' : 'transform 200ms ease' }}>
              <div className="relative z-10 w-full h-[calc(80vh-20px)] bg-muted overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-4 py-3 border-b border-border">
                  <h2 className="text-xl font-semibold text-white">Choose a Template</h2>
                  <p className="text-sm text-white/70 mt-1">Select a template to get started quickly</p>
                </div>

                {/* Template Grid */}
                <div className="relative flex-1" style={{ height: 'calc(80vh - 160px)' }}>
                  <div className="absolute inset-0 overflow-y-auto p-4">
                    <div className="grid grid-cols-1 gap-4">
                      {templates.map((template) => (
                        <div
                          key={template.id}
                          onClick={() => handleTemplateClick(template)}
                          className={`relative aspect-video rounded-xl overflow-hidden cursor-pointer hover:scale-[102%] transition-all duration-300 group ${selectedTemplate?.id === template.id ? 'ring-2 ring-primary' : ''
                            }`}
                        >
                          <img
                            src={template.image}
                            alt={template.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                              const nextElement = e.currentTarget.nextElementSibling as HTMLElement;
                              if (nextElement) nextElement.style.display = 'flex';
                            }}
                          />
                          <div className="w-full h-full bg-primary/20 flex items-center justify-center text-primary text-4xl font-medium" style={{ display: 'none' }}>
                            {template.category.charAt(0)}
                          </div>

                          {/* Selected badge */}
                          {selectedTemplate?.id === template.id && (
                            <div className="absolute top-4 left-4 bg-muted text-white px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1">
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                              Selected
                            </div>
                          )}

                          {/* Hover overlay with Select/Unselect Template button */}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-between p-4">
                            {/* Select/Unselect Template button - top right */}
                            <div className="flex justify-end">
                              {selectedTemplate?.id === template.id ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTemplate(null);
                                  }}
                                  className="button-outline px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1"
                                >
                                  Unselect template
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTemplateClick(template);
                                  }}
                                  className="button-gradient px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1"
                                >
                                  Select template
                                </button>
                              )}
                            </div>

                            {/* Title and description - bottom */}
                            <div>
                              <h3 className="font-semibold text-white text-sm mb-1">{template.title}</h3>
                              <p className="text-xs text-white/70 line-clamp-2">{template.description}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Coming Soon Overlay */}
                  <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex flex-col gap-4 items-center justify-center">
                    <img src="/logo-watermark.png" alt="Dreamify" className="w-32 h-32 object-contain" />
                    <p className="text-2xl font-bold text-white tracking-wide">Template is coming soon</p>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="flex-shrink-0 px-4 py-4 border-t border-border bg-muted/50">
                  <div className="flex justify-end">
                    <button
                      onClick={handleConfirmClick}
                      disabled={!selectedTemplate}
                      className="button-gradient px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {selectedTemplate ? `Confirm ${selectedTemplate.title} Template` : 'Select a template'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Desktop/Tablet Centered Dialog (hidden on mobile) */}
      <div className="hidden sm:flex fixed inset-0 z-[260] items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/80 hidden sm:block" onClick={onClose} />
        <div className="relative z-10 w-full max-w-6xl h-[80vh] bg-muted rounded-2xl border border-border shadow-xl overflow-hidden">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 p-2 rounded-md text-white/70 hover:text-white hover:bg-black transition-colors z-10"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {/* Header */}
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-2xl font-semibold text-white">Choose a Template</h2>
            <p className="text-sm text-white/70 mt-1">Select a template to get started quickly</p>
          </div>

          {/* Template Grid */}
          <div className="relative flex-1" style={{ height: 'calc(80vh - 160px)' }}>
            <div className="absolute inset-0 overflow-y-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    onClick={() => handleTemplateClick(template)}
                    className={`relative aspect-video rounded-xl overflow-hidden cursor-pointer hover:scale-[102%] transition-all duration-300 group ${selectedTemplate?.id === template.id ? 'ring-2 ring-primary' : ''
                      }`}
                  >
                    <img
                      src={template.image}
                      alt={template.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const nextElement = e.currentTarget.nextElementSibling as HTMLElement;
                        if (nextElement) nextElement.style.display = 'flex';
                      }}
                    />
                    <div className="w-full h-full bg-primary/20 flex items-center justify-center text-primary text-6xl font-medium" style={{ display: 'none' }}>
                      {template.category.charAt(0)}
                    </div>

                    {/* Selected badge */}
                    {selectedTemplate?.id === template.id && (
                      <div className="absolute top-4 left-4 bg-muted text-white px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1">
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        Selected
                      </div>
                    )}

                    {/* Hover overlay with Select/Unselect Template button */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-between p-4">
                      {/* Select/Unselect Template button - top right */}
                      <div className="flex justify-end">
                        {selectedTemplate?.id === template.id ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTemplate(null);
                            }}
                            className="button-outline px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1"
                          >
                            Unselect template
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTemplateClick(template);
                            }}
                            className="button-gradient px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1"
                          >
                            Select template
                          </button>
                        )}
                      </div>

                      {/* Title and description - bottom */}
                      <div>
                        <h3 className="font-semibold text-white text-sm mb-1">{template.title}</h3>
                        <p className="text-xs text-white/70 line-clamp-2">{template.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Coming Soon Overlay */}
            <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex flex-col gap-4 items-center justify-center">
              <img src="/logo-watermark.png" alt="Dreamify" className="w-32 h-32 object-contain" />
              <p className="text-3xl font-bold text-white tracking-wide">Template is coming soon</p>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex-shrink-0 px-6 py-4 border-t border-border bg-muted/50">
            <div className="flex justify-end">
              <button
                onClick={handleConfirmClick}
                disabled={!selectedTemplate}
                className="button-gradient px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {selectedTemplate ? `Confirm ${selectedTemplate.title} Template` : 'Select a template'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default TemplateModal;
