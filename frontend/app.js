// Same-origin by default — the backend serves this frontend directly.
const API_BASE = window.LANTERN_API_BASE || "/api";

const messagesEl = document.getElementById("messages");
const emptyState = document.getElementById("empty-state");
const form = document.getElementById("chat-form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");
const subjectInput = document.getElementById("subject");
const resetBtn = document.getElementById("reset");

let history = [];

function autoGrow() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
}
input.addEventListener("input", autoGrow);

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMessage(role, text) {
  if (emptyState) emptyState.style.display = "none";
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function renderTyping() {
  const div = document.createElement("div");
  div.className = "typing";
  div.id = "typing-indicator";
  div.innerHTML = "<span></span><span></span><span></span>";
  messagesEl.appendChild(div);
  scrollToBottom();
}

function removeTyping() {
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

// Parses one SSE "event:\ndata:\n\n" block into {event, data}
function parseSSEBlock(block) {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  return { event, data };
}

async function sendMessage(text) {
  history.push({ role: "user", content: text });
  renderMessage("user", text);

  sendBtn.disabled = true;
  removeTyping();
  renderTyping();

  let assistantEl = null;
  let assistantText = "";

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history,
        subject: subjectInput.value.trim() || undefined,
      }),
    });

    if (!res.ok || !res.body) {
      removeTyping();
      const data = await res.json().catch(() => ({}));
      renderMessage("error", data.error || "Lantern couldn't respond just now. Try again in a moment.");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop(); // keep incomplete block for next chunk

      for (const block of blocks) {
        if (!block.trim()) continue;
        const { event, data } = parseSSEBlock(block);
        if (!data) continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        if (event === "token" && parsed.text) {
          if (!assistantEl) {
            removeTyping();
            assistantEl = renderMessage("assistant", "");
          }
          assistantText += parsed.text;
          assistantEl.textContent = assistantText;
          scrollToBottom();
        } else if (event === "error") {
          removeTyping();
          renderMessage("error", parsed.message || "The response was interrupted.");
        } else if (event === "done") {
          // stream finished cleanly
        }
      }
    }

    if (assistantText) {
      history.push({ role: "assistant", content: assistantText });
    }
  } catch (err) {
    removeTyping();
    if (!assistantText) {
      renderMessage("error", "Couldn't reach the server. Check your connection and try again.");
    }
  } finally {
    removeTyping();
    sendBtn.disabled = false;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  autoGrow();
  sendMessage(text);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

resetBtn.addEventListener("click", () => {
  history = [];
  messagesEl.innerHTML = "";
  const fresh = emptyState.cloneNode(true);
  fresh.style.display = "block";
  messagesEl.appendChild(fresh);
});
