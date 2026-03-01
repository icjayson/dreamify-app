export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  isError?: boolean;
  attachment?: {
    kind: "csv" | "file";
    name: string;
    mime?: string;
  };
  template?: {
    id: string;
    title: string;
    description: string;
    image: string;
    category: string;
  };
  dashboardCard?: {
    sourceFileName: string;
    dashboardId: string;
    dashboardTitle?: string;
  };
}