import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";

export const FEEDBACK_LINK = "https://form.typeform.com/to/ARE0k6zY"; // TODO: Update with your actual feedback link

export function FeedbackFloatingButton() {
    const [isHovered, setIsHovered] = useState(false);

    return (
        <a
            href={FEEDBACK_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="button-gradient fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-md button-gradient text-white shadow-[0_0_20px_rgba(255,255,255,0.2)] hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] transition-all duration-300 transform hover:scale-105"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <MessageSquarePlus className="w-5 h-5" />
            <span className="text-sm font-medium whitespace-nowrap transition-all duration-300">
                {isHovered ? "Feel free to feedback us, we build it for you!" : "Feedback us"}
            </span>
        </a>
    );
}

export function FeedbackProjectButton() {
    return (
        <a
            href={FEEDBACK_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="button-outline h-8 px-2 md:px-4 mr-2 rounded-md text-sm flex items-center gap-2"
        >
            <MessageSquarePlus className="w-4 h-4 md:hidden" />
            <span className="hidden md:inline">Feedback us</span>
        </a>
    );
}
