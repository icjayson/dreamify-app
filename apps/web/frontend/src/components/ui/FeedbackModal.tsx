import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { feedbackService } from "@/services/feedbackService";
import { useToast } from "@/hooks/use-toast";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  category: string;
  placeholder?: string;
}

export default function FeedbackModal({
  open,
  onClose,
  category,
  placeholder,
}: FeedbackModalProps) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      await feedbackService.submit({ category, message: message.trim() });
      toast({ title: "Thank you!", description: "Your feedback has been sent to our team." });
      setMessage("");
      onClose();
    } catch {
      toast({ title: "Failed to send", description: "Please try again later.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Feedback for Dreamify team</DialogTitle>
          <DialogDescription>
            We build it for you — tell us what you need.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={placeholder || "Tell us what you'd like to see..."}
          rows={4}
          className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none resize-vertical min-h-[100px]"
          maxLength={5000}
          autoFocus
        />
        <div className="flex justify-end">
          <Button
            onClick={handleSubmit}
            disabled={!message.trim() || submitting}
            className="button-gradient"
          >
            {submitting ? "Sending..." : "Submit"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
