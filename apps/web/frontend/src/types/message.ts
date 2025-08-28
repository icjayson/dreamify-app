export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  attachment?: {
    kind: "csv" | "file";
    name: string;
    mime?: string;
  };
}