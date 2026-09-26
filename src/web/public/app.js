/* YarOperator Executive Assistant Frontend Logic */

document.addEventListener("DOMContentLoaded", () => {
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const userBadge = document.getElementById("userBadge");
  const userEmail = document.getElementById("userEmail");
  const avatarLetter = document.getElementById("avatarLetter");
  const messagesList = document.getElementById("messagesList");
  const welcomeBanner = document.getElementById("welcomeBanner");
  const thinkingBar = document.getElementById("thinkingBar");
  const healthBadge = document.getElementById("healthBadge");
  const healthText = document.getElementById("healthText");
  const suggestionChips = document.getElementById("suggestionChips");

  let isSubmitting = false;
  let currentUser = null;

  // Auto-resize textarea according to text height
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 160)}px`;
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

  // Suggestion chips handler
  if (suggestionChips) {
    suggestionChips.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip-btn");
      if (!btn) return;
      const cmd = btn.getAttribute("data-command");
      if (cmd) {
        chatInput.value = cmd;
        chatInput.focus();
        chatInput.dispatchEvent(new Event("input"));
      }
    });
  }

  // Initialize page & check health + auth
  checkHealthStatus();
  checkAuthSession();

  async function checkHealthStatus() {
    try {
      const res = await fetch("/health", { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        const healthStatus = data.health ? data.health.status : null;
        if (healthBadge) healthBadge.classList.remove("degraded", "unhealthy", "offline");

        if (healthStatus === "HEALTHY") {
          if (healthText) healthText.textContent = "سیستم آماده";
        } else if (healthStatus === "DEGRADED") {
          if (healthBadge) healthBadge.classList.add("degraded");
          if (healthText) healthText.textContent = "کارکرد با اختلال (Degraded)";
        } else if (healthStatus === "UNHEALTHY") {
          if (healthBadge) healthBadge.classList.add("unhealthy");
          if (healthText) healthText.textContent = "سیستم ناپایدار (Unhealthy)";
        } else {
          if (healthBadge) healthBadge.classList.add("unhealthy");
          if (healthText) healthText.textContent = "وضعیت ناشناخته";
        }
      } else {
        if (healthBadge) healthBadge.classList.add("offline");
        if (healthText) healthText.textContent = "ارتباط ناموفق";
      }
    } catch (err) {
      if (healthBadge) healthBadge.classList.add("offline");
      if (healthText) healthText.textContent = "قطع ارتباط سرور";
    }
  }

  async function checkAuthSession() {
    try {
      const res = await fetch("/auth/me", { method: "GET" });
      const data = await res.json();

      if (data.authenticated && data.user) {
        currentUser = data.user;
        if (loginBtn) loginBtn.classList.add("hidden");
        if (userBadge) userBadge.classList.remove("hidden");
        if (userEmail) userEmail.textContent = currentUser.email;
        if (avatarLetter && currentUser.email) {
          avatarLetter.textContent = currentUser.email.charAt(0).toUpperCase();
        }
      } else {
        currentUser = null;
        if (loginBtn) loginBtn.classList.remove("hidden");
        if (userBadge) userBadge.classList.add("hidden");
      }
    } catch (err) {
      console.error("Auth session check failed:", err);
    }
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await fetch("/auth/logout", { method: "POST" });
        window.location.reload();
      } catch (err) {
        alert("خطا در خروج از حساب کاربری.");
      }
    });
  }

  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const messageText = chatInput.value.trim();

    if (!messageText || isSubmitting) return;

    // Hide welcome banner on first submitted message
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
      const headers = {
        "Content-Type": "application/json"
      };

      // 2. Submit request to POST /api/v1/operator/chat
      const response = await fetch("/api/v1/operator/chat", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({
          workspaceId: "yartrader",
          environmentId: "env_yartrader",
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
      if (healthBadge) healthBadge.classList.add("busy");
      if (healthText) healthText.textContent = "در حال پردازش";
    } else {
      thinkingBar.classList.add("hidden");
      if (healthBadge) healthBadge.classList.remove("busy");
      if (healthText) healthText.textContent = "سیستم آماده";
    }
  }

  function renderOwnerMessage(text) {
    const msgDiv = document.createElement("div");
    msgDiv.className = "message-item owner";

    const header = document.createElement("div");
    header.className = "message-header";
    const timeStr = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    header.innerHTML = `
      <span class="message-author">مالک (Owner)</span>
      <span class="message-time">${timeStr}</span>
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
    const timeStr = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

    const header = document.createElement("div");
    header.className = "message-header";
    header.innerHTML = `
      <span class="message-author">
        <svg width="14" height="14" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M 20 20 L 50 50 L 50 85" stroke="#D4AF37" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M 80 20 L 50 50" stroke="#D4AF37" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        YarOperator
      </span>
      <span class="status-badge ${status}">${translateStatus(status)}</span>
    `;

    const content = document.createElement("div");
    content.className = "message-content";

    // Executive Assistant response text formulation
    let textOutput = "";

    if (
      result.resolvedCapability === "conversation" &&
      result.details &&
      result.details.evidence &&
      result.details.evidence.summary
    ) {
      textOutput = result.details.evidence.summary;
    } else if (status === "COMPLETED") {
      textOutput = "حتماً. اقدام درخواستی با موفقیت انجام شد.";
    } else if (status === "APPROVAL_REQUIRED") {
      textOutput = "برای انجام این اقدام به تأیید شما نیاز دارم. فعلاً متوقف می‌مانم.";
    } else if (status === "BLOCKED") {
      textOutput = "این اقدام در محدوده اختیار فعلی من نیست و اجازه اجرای آن را ندارم.";
    } else if (status === "FAILED") {
      textOutput = "در اجرای درخواست مشکلی پیش آمد و اقدام انجام نشد.";
    } else {
      textOutput = "درخواست شما دریافت شد و بررسی گردید.";
    }

    content.textContent = textOutput;
    msgDiv.appendChild(header);
    msgDiv.appendChild(content);

    // Generic Data-Driven Tool Execution Result Renderer
    let stepResult = null;

    if (result.details && result.details.executedSteps) {
      const lastStep = result.details.executedSteps[result.details.executedSteps.length - 1];
      if (lastStep) {
        stepResult = lastStep.result !== undefined ? lastStep.result : lastStep.toolOutput;
      }
    }

    if (!stepResult && result.details && result.details.evidence && result.details.evidence.toolResult) {
      stepResult = result.details.evidence.toolResult;
    }

    if (stepResult !== null && stepResult !== undefined) {
      const codeDiv = document.createElement("div");
      codeDiv.className = "code-block";
      const outputStr = typeof stepResult === "string"
        ? stepResult
        : JSON.stringify(stepResult, null, 2);
      codeDiv.textContent = outputStr;
      msgDiv.appendChild(codeDiv);
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
