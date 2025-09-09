"use client";
import ChatWidget from "./frontend/ChatWidget";

export default function Page() {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <h1>AI Chatbot</h1>
      </div>
      <div>
        <ChatWidget />
      </div>
    </>
  );
}
