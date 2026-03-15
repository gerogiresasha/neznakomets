(() => {
  const app = document.getElementById("app");
  const bg = document.getElementById("bg");
  const content = document.getElementById("content");
  const STORAGE_KEY = "currentSceneId";
  const DEFAULT_PLAYER_NAME = "незнакомка";
  const vkBridge = window.vkBridge || null;
  let vkBridgeInited = window.__vkBridgeInited === true;
  const VK_DEBUG = new URLSearchParams(window.location.search).get("vkdebug") === "1"
    || localStorage.getItem("vkdebug") === "1";
  const VK_BRIDGE_TIMEOUT_MS = 5000;
  const VK_BRIDGE_RETRY_DELAY_MS = 400;
  const VK_BRIDGE_INTERACTIVE_TIMEOUT_MS = 60000;
  const VK_DEBUG_AUTOHIDE_MS = 8000;

  const logVk = (...args) => {
    if (!window.__vkBridgeLogs) window.__vkBridgeLogs = [];
    window.__vkBridgeLogs.push({ ts: Date.now(), args });
    if (window.__vkBridgeLogs.length > 50) {
      window.__vkBridgeLogs.shift();
    }
    if (VK_DEBUG) {
      console.log(...args);
    }
    if (typeof window.__vkDebugUpdate === "function") {
      window.__vkDebugUpdate();
    }
  };

  const formatVkArg = (arg) => {
    if (arg instanceof Error) return arg.message;
    if (typeof arg === "string") return arg;
    try {
      return JSON.stringify(arg);
    } catch (error) {
      return String(arg);
    }
  };

  const formatVkLog = (entry) => {
    const time = new Date(entry.ts).toLocaleTimeString("ru-RU", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const message = entry.args.map(formatVkArg).join(" ");
    return `[${time}] ${message}`;
  };

  const initDebugPanel = () => {
    if (!VK_DEBUG) return;
    const wrap = document.createElement("div");
    wrap.className = "vk-debug";
    const toggle = document.createElement("button");
    toggle.className = "vk-debug-toggle";
    toggle.type = "button";
    toggle.textContent = "VK Логи";
    const panel = document.createElement("div");
    panel.className = "vk-debug-panel";
    panel.hidden = true;
    const header = document.createElement("div");
    header.className = "vk-debug-header";
    const title = document.createElement("div");
    title.textContent = "VK Bridge logs";
    const actions = document.createElement("div");
    actions.className = "vk-debug-actions";
    const copyBtn = document.createElement("button");
    copyBtn.className = "vk-debug-btn";
    copyBtn.type = "button";
    copyBtn.textContent = "Copy";
    const saveBtn = document.createElement("button");
    saveBtn.className = "vk-debug-btn";
    saveBtn.type = "button";
    saveBtn.textContent = "Save";
    const clearBtn = document.createElement("button");
    clearBtn.className = "vk-debug-btn";
    clearBtn.type = "button";
    clearBtn.textContent = "Clear";
    actions.appendChild(copyBtn);
    actions.appendChild(saveBtn);
    actions.appendChild(clearBtn);
    header.appendChild(title);
    header.appendChild(actions);
    const list = document.createElement("pre");
    list.className = "vk-debug-list";
    panel.appendChild(header);
    panel.appendChild(list);
    wrap.appendChild(toggle);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);

    const update = () => {
      const logs = window.__vkBridgeLogs || [];
      list.textContent = logs.map(formatVkLog).join("\n");
    };
    window.__vkDebugUpdate = update;
    update();

    let hideTimer = null;
    const scheduleHide = () => {
      if (panel.hidden) return;
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        panel.hidden = true;
      }, VK_DEBUG_AUTOHIDE_MS);
    };

    toggle.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (panel.hidden) {
        if (hideTimer) clearTimeout(hideTimer);
      } else {
        scheduleHide();
      }
    });

    clearBtn.addEventListener("click", () => {
      window.__vkBridgeLogs = [];
      update();
      scheduleHide();
    });

    copyBtn.addEventListener("click", async () => {
      const text = list.textContent || "";
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          logVk("VK debug copied to clipboard");
        } else {
          throw new Error("clipboard-unavailable");
        }
      } catch (error) {
        logVk("VK debug copy failed:", error);
      }
      scheduleHide();
    });

    saveBtn.addEventListener("click", () => {
      const text = list.textContent || "";
      const stamp = new Date();
      const pad = (value) => String(value).padStart(2, "0");
      const filename = `vk-bridge-logs-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.txt`;
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      logVk("VK debug saved:", filename);
      scheduleHide();
    });

    ["mousemove", "touchstart", "wheel", "keydown", "click"].forEach((eventName) => {
      panel.addEventListener(eventName, scheduleHide, { passive: true });
    });
  };

  if (vkBridge && typeof vkBridge.subscribe === "function") {
    vkBridge.subscribe((event) => logVk("VK Bridge event:", event));
  }

  if (vkBridge && !VK_DEBUG) {
    console.info("VK debug is off. Enable with: localStorage.setItem(\"vkdebug\",\"1\"); location.reload();");
  }

  window.__appLoaded = true;
  let story = null;
  let currentSceneId = null;
  let currentAudio = null;
  let playerName = DEFAULT_PLAYER_NAME;

  const safeText = (text) => (text || "").replace(/\{\{name\}\}/g, playerName);

  const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

  const INTERACTIVE_METHODS = new Set([
    "VKWebAppGetAuthToken",
    "VKWebAppShowWallPostBox",
    "VKWebAppShowShareBox",
    "VKWebAppShare",
  ]);

  const sendVk = (method, params = {}) => {
    const timeout = INTERACTIVE_METHODS.has(method)
      ? VK_BRIDGE_INTERACTIVE_TIMEOUT_MS
      : VK_BRIDGE_TIMEOUT_MS;
    return withTimeout(vkBridge.send(method, params), timeout);
  };

  const getShareLink = () => {
    const params = new URLSearchParams(window.location.search);
    const appId = params.get("vk_app_id");
    if (appId) return `https://vk.com/app${appId}`;
    return `${window.location.origin}${window.location.pathname}`;
  };

  const getVkAppId = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get("vk_app_id");
  };

  const ensureVkInit = async () => {
    if (vkBridgeInited) return;
    await sendVk("VKWebAppInit");
    vkBridgeInited = true;
    window.__vkBridgeInited = true;
    logVk("VK Bridge init ok");
  };

  const initPlayerName = async () => {
    if (!vkBridge) return DEFAULT_PLAYER_NAME;
    try {
      await ensureVkInit();
      let data = null;
      try {
        data = await sendVk("VKWebAppGetUserInfo");
      } catch (error) {
        if (error && error.message === "timeout") {
          await new Promise((resolve) => setTimeout(resolve, VK_BRIDGE_RETRY_DELAY_MS));
          data = await sendVk("VKWebAppGetUserInfo");
        } else {
          throw error;
        }
      }
      logVk("VKWebAppGetUserInfo result:", data);
      return data && data.first_name ? data.first_name : DEFAULT_PLAYER_NAME;
    } catch (error) {
      console.warn("VK Bridge get name failed:", error);
      logVk("VK Bridge get name failed:", error);
      return DEFAULT_PLAYER_NAME;
    }
  };

  const setShareStatus = (node, text, isError = false) => {
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("error", isError);
  };

  const shareWall = async (text, statusNode) => {
    if (!vkBridge) {
      console.log("share wall:", text);
      setShareStatus(statusNode, "Шеринг на стену недоступен вне VK.");
      return;
    }
    try {
      await ensureVkInit();
      await sendVk("VKWebAppShowWallPostBox", {
        message: text,
      });
      logVk("VKWebAppShowWallPostBox ok");
      setShareStatus(statusNode, "Окно публикации открыто.");
    } catch (error) {
      console.warn("VK Bridge share failed:", error);
      logVk("VK Bridge share failed:", error);
      try {
        const appId = getVkAppId();
        if (!appId) {
          setShareStatus(statusNode, "Не удалось получить app_id для запроса прав.", true);
          return;
        }
        setShareStatus(statusNode, "Запрашиваем доступ к стене...");
        logVk("VKWebAppGetAuthToken request");
        const auth = await sendVk("VKWebAppGetAuthToken", {
          app_id: Number(appId),
          scope: "wall",
        });
        const token = auth && auth.access_token;
        if (!token) {
          setShareStatus(statusNode, "Доступ к стене не выдан.", true);
          return;
        }
        logVk("VKWebAppGetAuthToken ok");
        setShareStatus(statusNode, "Публикуем пост...");
        const link = getShareLink();
        const result = await sendVk("VKWebAppCallAPIMethod", {
          method: "wall.post",
          params: {
            message: text,
            attachments: link,
            v: "5.131",
            access_token: token,
          },
        });
        logVk("VKWebAppCallAPIMethod wall.post ok:", result);
        setShareStatus(statusNode, "Пост опубликован.");
      } catch (fallbackError) {
        console.warn("VK Bridge wall.post fallback failed:", fallbackError);
        logVk("VK Bridge wall.post fallback failed:", fallbackError);
        setShareStatus(statusNode, "На стену не получилось. В dev‑режиме это часто блокируется.", true);
      }
    }
  };

  const shareLink = async (statusNode) => {
    if (!vkBridge) {
      const link = getShareLink();
      console.log("share link:", link);
      setShareStatus(statusNode, "Ссылка выведена в консоль.");
      return;
    }
    try {
      await ensureVkInit();
      const link = getShareLink();
      if (vkBridge.supports && vkBridge.supports("VKWebAppShowShareBox")) {
        await sendVk("VKWebAppShowShareBox", { link });
        logVk("VKWebAppShowShareBox ok");
        setShareStatus(statusNode, "Окно отправки открыто.");
        return;
      }
      await sendVk("VKWebAppShare", { link });
      logVk("VKWebAppShare ok");
      setShareStatus(statusNode, "Окно отправки открыто.");
    } catch (error) {
      console.warn("VK Bridge fallback share failed:", error);
      logVk("VK Bridge fallback share failed:", error);
      setShareStatus(statusNode, "Не удалось открыть окно отправки.", true);
    }
  };

  const preloadBackground = (sceneId) => {
    if (!sceneId || !story || !story.scenes[sceneId]) return;
    const img = new Image();
    img.src = story.scenes[sceneId].background;
  };

  const playAudio = (scene) => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if (!scene.audio) return;
    currentAudio = new Audio(scene.audio);
    currentAudio.play().catch(() => {
      // Autoplay may be blocked; ignore.
    });
  };

  const fadeIn = () => {
    app.classList.add("fade");
    // Two rAFs to ensure the browser applies the class before removing it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        app.classList.remove("fade");
      });
    });
  };

  const setBackground = (scene) => {
    bg.style.backgroundImage = `url('${scene.background}')`;
  };

  const saveProgress = (sceneId) => {
    localStorage.setItem(STORAGE_KEY, sceneId);
  };

  const goTo = (sceneId) => {
    if (!sceneId || !story.scenes[sceneId]) return;
    currentSceneId = sceneId;
    renderScene();
  };

  const createButton = (label, onClick, isPrimary = false) => {
    const btn = document.createElement("button");
    btn.className = `button${isPrimary ? " primary" : ""}`;
    btn.textContent = label;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return btn;
  };

  const renderScene = (skipDepth = 0) => {
    const scene = story.scenes[currentSceneId];
    if (!scene) return;

    if (scene.type === "share_card") {
      if (skipDepth > 5) {
        console.warn("share_card skip depth exceeded:", scene.id);
        return;
      }
      if (scene.next) {
        currentSceneId = scene.next;
        return renderScene(skipDepth + 1);
      }
      console.warn("share_card without next:", scene.id);
      return;
    }

    saveProgress(currentSceneId);
    setBackground(scene);
    playAudio(scene);

    content.innerHTML = "";

    if (scene.type === "narration") {
      const text = document.createElement("div");
      text.className = "narration";
      text.textContent = safeText(scene.text);
      content.appendChild(text);
    }

    if (scene.type === "message") {
      const bubble = document.createElement("div");
      bubble.className = `bubble ${scene.character === "player" ? "player" : "mark"}`;
      bubble.textContent = safeText(scene.text);
      content.appendChild(bubble);
    }

    if (scene.type === "choice") {
      const actions = document.createElement("div");
      actions.className = "actions";
      scene.choices.forEach((choice) => {
        actions.appendChild(
          createButton(choice.text, () => goTo(choice.next))
        );
      });
      content.appendChild(actions);
    }

    if (scene.type === "ending") {
      const text = document.createElement("div");
      text.className = "narration";
      text.textContent = safeText(scene.text);
      content.appendChild(text);

      const actions = document.createElement("div");
      actions.className = "actions";
      const shareStatus = document.createElement("div");
      shareStatus.className = "share-status";
      actions.appendChild(
        createButton("Поделиться ссылкой", () => {
          setShareStatus(shareStatus, "");
          shareLink(shareStatus);
        })
      );
      actions.appendChild(
        createButton("Пост на стене", () => {
          const shareText = safeText(scene.share_text || scene.text);
          setShareStatus(shareStatus, "");
          shareWall(shareText, shareStatus);
        })
      );
      actions.appendChild(
        createButton("Начать заново", () => {
          localStorage.removeItem(STORAGE_KEY);
          goTo(story.start);
        }, true)
      );
      actions.appendChild(shareStatus);
      content.appendChild(actions);
    }

    if (scene.type !== "choice" && scene.type !== "ending" && scene.type !== "share_card") {
      const actions = document.createElement("div");
      actions.className = "actions";
      actions.appendChild(
        createButton("Далее", () => {
          if (scene.next) goTo(scene.next);
        }, true)
      );
      content.appendChild(actions);
    }

    if (scene.next) {
      preloadBackground(scene.next);
    }

    fadeIn();
  };

  const enableTapToAdvance = () => {
    app.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const scene = story.scenes[currentSceneId];
      if (!scene) return;
      if (scene.type === "choice" || scene.type === "ending") return;
      if (scene.next) goTo(scene.next);
    });
  };

  const init = async () => {
    initDebugPanel();
    const response = await fetch("js/story.json", { cache: "no-store" });
    story = await response.json();
    const saved = localStorage.getItem(STORAGE_KEY);
    currentSceneId = saved && story.scenes[saved] ? saved : story.start;
    if (saved && !story.scenes[saved]) {
      localStorage.removeItem(STORAGE_KEY);
    }
    enableTapToAdvance();
    renderScene();
    initPlayerName().then((name) => {
      playerName = name || DEFAULT_PLAYER_NAME;
      renderScene();
    });
  };

  init().catch((err) => {
    console.error("Failed to load story:", err);
    app.classList.remove("fade");
    content.innerHTML = "<div class=\"narration\">Не удалось загрузить историю. Проверь консоль и сеть.</div>";
  });
})();
