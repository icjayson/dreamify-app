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
    sourceType?: string;
    accountName?: string;
    propertyName?: string;
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