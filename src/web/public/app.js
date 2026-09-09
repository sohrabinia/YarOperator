/* YarOperator Executive Assistant Frontend Logic */

document.addEventListener("DOMContentLoaded", () => {
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const tokenInput = document.getElementById("tokenInput");
  const messagesList = document.getElementById("messagesList");
  const welcomeBanner = document.getElementById("welcomeBanner");
  const thinkingBar = document.getElementById("thinkingBar");
  const connectionPill = document.getElementById("connectionPill");
  const statusLabel = document.getElementById("statusLabel");

  let isSubmitting = false;

  // Auto-resize textarea
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 150)}px`;
  });

  // Handle keyboard submit: Enter = send, Shift + Enter = newline
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isSubmitting) {
        chatForm.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    }
  });

  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const messageText = chatInput.value.trim();
    const token = tokenInput.value.trim();

    if (!messageText || isSubmitting) return;

    if (!token) {
      alert("لطفاً کلید دسترسی (Bearer Token) را وارد کنید.");
      return;
    }

    // Hide welcome banner on first message
    if (welcomeBanner) {
      welcomeBanner.style.display = "none";
    }

    // 1. Render Owner Message
    renderOwnerMessage(messageText);

    // Reset input state
    chatInput.value = "";
    chatInput.style.height = "auto";
    setSubmittingState(true);

    try {
      // 2. Submit request to POST /api/v1/operator/chat
      const response = await fetch("/api/v1/operator/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          workspaceId: "default",
          environmentId: "development",
          rawCommandText: messageText
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        renderErrorMessage(data.error || "خطا در ارتباط با سرور.");
      } else {
        renderOperatorResponse(data.result);
      }
    } catch (err) {
      renderErrorMessage(`خطای شبکه: ${err.message}`);
    } finally {
      setSubmittingState(false);
    }
  });

  function setSubmittingState(submitting) {
    isSubmitting = submitting;
    sendBtn.disabled = submitting;
    chatInput.disabled = submitting;

    if (submitting) {
      thinkingBar.classList.remove("hidden");
      connectionPill.classList.add("thinking");
      statusLabel.textContent = "در حال پردازش";
    } else {
      thinkingBar.classList.add("hidden");
      connectionPill.classList.remove("thinking");
      statusLabel.textContent = "آماده";
    }
  }

  function renderOwnerMessage(text) {
    const msgDiv = document.createElement("div");
    msgDiv.className = "message-item owner";

    const header = document.createElement("div");
    header.className = "message-header";
    header.innerHTML = `
      <span class="message-author">مالک (Owner)</span>
      <span>${new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</span>
    `;

    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = text;

    msgDiv.appendChild(header);
    msgDiv.appendChild(content);
    messagesList.appendChild(msgDiv);
    scrollToBottom();
  }

  function renderOperatorResponse(result) {
    const msgDiv = document.createElement("div");
    msgDiv.className = "message-item operator";

    const status = result.status || "SAFE";
    const header = document.createElement("div");
    header.className = "message-header";
    header.innerHTML = `
      <span class="message-author">YarOperator</span>
      <span class="status-badge ${status}">${translateStatus(status)}</span>
    `;

    const content = document.createElement("div");
    content.className = "message-content";

    // Executive Assistant Personality-driven response formatting
    let textOutput = "";

    if (status === "COMPLETED") {
      textOutput = "حتماً. اقدام درخواستی با موفقیت انجام شد.";
    } else if (status === "APPROVAL_REQUIRED") {
      textOutput = "برای این اقدام به تأیید شما نیاز دارم. فعلاً متوقف می‌مانم.";
    } else if (status === "BLOCKED") {
      textOutput = "این اقدام در محدوده اختیار فعلی من نیست و نمی‌توانم آن را اجرا کنم.";
    } else if (status === "FAILED") {
      textOutput = "در اجرای درخواست مشکلی پیش آمد. اقدام انجام نشده است.";
    } else {
      textOutput = "درخواست شما دریافت شد.";
    }

    content.textContent = textOutput;
    msgDiv.appendChild(header);
    msgDiv.appendChild(content);

    // Safe Execution Details / Command Output Display
    if (result.details && result.details.executedSteps) {
      const lastStep = result.details.executedSteps[result.details.executedSteps.length - 1];
      if (lastStep && lastStep.toolOutput) {
        const codeDiv = document.createElement("div");
        codeDiv.className = "code-block";
        const outputStr = typeof lastStep.toolOutput === "string"
          ? lastStep.toolOutput
          : JSON.stringify(lastStep.toolOutput, null, 2);
        codeDiv.textContent = outputStr;
        msgDiv.appendChild(codeDiv);
      }
    }

    messagesList.appendChild(msgDiv);
    scrollToBottom();
  }

  function renderErrorMessage(errText) {
    const msgDiv = document.createElement("div");
    msgDiv.className = "message-item operator";

    const header = document.createElement("div");
    header.className = "message-header";
    header.innerHTML = `
      <span class="message-author">YarOperator</span>
      <span class="status-badge FAILED">خطا</span>
    `;

    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = `خطا: ${errText}`;

    msgDiv.appendChild(header);
    msgDiv.appendChild(content);
    messagesList.appendChild(msgDiv);
    scrollToBottom();
  }

  function translateStatus(status) {
    const map = {
      SAFE: "ایمن",
      EXECUTING: "در حال اجرا",
      APPROVAL_REQUIRED: "نیازمند تأیید",
      BLOCKED: "مسدود شده",
      COMPLETED: "تکمیل شده",
      FAILED: "ناموفق"
    };
    return map[status] || status;
  }

  function scrollToBottom() {
    const chatMain = document.getElementById("chatMain");
    chatMain.scrollTop = chatMain.scrollHeight;
  }
});
