import { useState } from "react";
import HomePage from "@/pages/HomePage";
import { useChatStore } from "@/chat/useChatStore";

const Index = () => {
  // Always render HomePage on "/"; hero chat will navigate to /workspace/project upon submit
  return (
    <div className="min-h-screen bg-background overflow-hidden">
      <HomePage 
        onGetStarted={() => { /* no-op: HomePage handles navigation on submit */ }}
        onProcessedDataChange={() => { /* no-op placeholder */ }}
      />
    </div>
  );
};

export default Index;