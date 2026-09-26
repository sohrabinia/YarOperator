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

    // Executive Assistant response text formulation with dynamic evidence synthesis
    let textOutput = "";

    const summaryEvidence = result.details && result.details.evidence && result.details.evidence.summary;

    if (summaryEvidence) {
      textOutput = summaryEvidence;
    } else if (status === "COMPLETED") {
      textOutput = "اقدام درخواستی با موفقیت اجرا شد. نتایج و شواهد کامل در زیر گزارش شده است:";
    } else if (status === "APPROVAL_REQUIRED") {
      textOutput = `برای انجام این اقدام به تأیید شما نیاز است. علت: ${result.reason || "نیاز به مجوز سطح بالادست"}`;
    } else if (status === "BLOCKED") {
      textOutput = `این اقدام در محدوده اختیار مجاز قرار ندارد و مسدود گردید. علت: ${result.reason || "شیوه‌نامه امنیتی BLOCKED"}`;
    } else if (status === "FAILED") {
      const errDetail = result.reason || (result.details && result.details.error) || "خطا در اجرای ابزار";
      textOutput = `در اجرای درخواست مشکلی پیش آمد: ${errDetail}`;
    } else {
      textOutput = "درخواست شما دریافت گردید و وضعیت آن گزارش می‌شود:";
    }

    content.textContent = textOutput;
    msgDiv.appendChild(header);
    msgDiv.appendChild(content);

    // Render tool execution output / evidence dynamically for all executed steps
    if (result.details && Array.isArray(result.details.executedSteps) && result.details.executedSteps.length > 0) {
      for (const step of result.details.executedSteps) {
        const outputData = step.result !== undefined ? step.result : step.toolOutput;
        if (outputData !== undefined && outputData !== null) {
          const codeDiv = document.createElement("div");
          codeDiv.className = "code-block";
          const outputStr = typeof outputData === "string"
            ? outputData
            : JSON.stringify(outputData, null, 2);
          codeDiv.textContent = outputStr;
          msgDiv.appendChild(codeDiv);
        } else if (step.error) {
          const errDiv = document.createElement("div");
          errDiv.className = "code-block error";
          errDiv.textContent = `خطای گام [${step.stepId || step.toolId}]: ${step.error}`;
          msgDiv.appendChild(errDiv);
        }
      }
    } else if (result.details && result.details.evidence && !summaryEvidence) {
      const codeDiv = document.createElement("div");
      codeDiv.className = "code-block";
      codeDiv.textContent = JSON.stringify(result.details.evidence, null, 2);
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
